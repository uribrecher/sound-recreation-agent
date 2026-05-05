import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { AgentClient } from "../src/client.js";
import type { ChatEvent } from "../src/types.js";

interface MockFetchCall {
  url: string | URL;
  init: RequestInit | undefined;
}

let calls: MockFetchCall[] = [];
let nextResponse: () => Response = () => new Response("");
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input as string | URL, init });
    return nextResponse();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(enc.encode(lines[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function sseResponse(lines: string[], status = 200): Response {
  return new Response(streamFromLines(lines), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(client: AgentClient, text: string, signal?: AbortSignal): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const ev of client.send(text, signal ? { signal } : undefined)) {
    events.push(ev);
  }
  return events;
}

describe("AgentClient", () => {
  it("commits user and assistant messages on a successful stream", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"text-delta","delta":"hello"}\n`,
      `data: {"type":"text-delta","delta":" world"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://localhost:2999" });
    const events = await collect(client, "hi");

    assert.strictEqual(client.messages.length, 2);
    assert.strictEqual(client.messages[0]?.role, "user");
    assert.strictEqual(client.messages[0]?.parts[0]?.text, "hi");
    assert.strictEqual(client.messages[1]?.role, "assistant");
    assert.strictEqual(client.messages[1]?.parts[0]?.text, "hello world");

    const types = events.map((e) => e.type);
    assert.deepStrictEqual(types, ["text-delta", "text-delta", "done"]);
    const last = events.at(-1)!;
    assert.strictEqual(last.type === "done" ? last.assistantText : null, "hello world");
  });

  it("translates wire-format tool events into the public ChatEvent shape", async () => {
    // Real wire format from the AI SDK UI Message Stream:
    //   - tool-input-start carries `toolCallId` + `toolName`
    //   - tool-input-available carries `toolCallId` + `toolName` + `input`
    //   - tool-output-available carries `toolCallId` + `output` (NO toolName)
    // The SDK tracks toolCallId → toolName from input-start and synthesizes
    // toolName on the output event.
    nextResponse = () => sseResponse([
      `data: {"type":"tool-input-start","toolCallId":"tc_1","toolName":"web_search"}\n`,
      `data: {"type":"tool-input-available","toolCallId":"tc_1","toolName":"web_search","input":{"query":"a-ha"}}\n`,
      `data: {"type":"tool-output-available","toolCallId":"tc_1","output":{"results":["ok"]}}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const events = await collect(client, "search");

    assert.strictEqual(events[0]?.type, "tool-input-start");
    assert.strictEqual((events[0] as { toolName: string }).toolName, "web_search");

    assert.strictEqual(events[1]?.type, "tool-input-available");
    assert.strictEqual((events[1] as { toolName: string }).toolName, "web_search");
    assert.deepStrictEqual(
      (events[1] as { input: unknown }).input,
      { query: "a-ha" },
    );

    assert.strictEqual(events[2]?.type, "tool-output-available");
    // toolName must be SYNTHESIZED — the wire event has no toolName field.
    assert.strictEqual((events[2] as { toolName: string }).toolName, "web_search");
    assert.deepStrictEqual(
      (events[2] as { output: unknown }).output,
      { results: ["ok"] },
    );
  });

  it("synthesizes toolName=\"\" on tool-output-available when toolCallId is unknown", async () => {
    // Edge case: output event arrives without a preceding input-start.
    // SDK should not crash; toolName falls back to empty string.
    nextResponse = () => sseResponse([
      `data: {"type":"tool-output-available","toolCallId":"tc_orphan","output":{"x":1}}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const events = await collect(client, "x");

    assert.strictEqual(events[0]?.type, "tool-output-available");
    assert.strictEqual((events[0] as { toolName: string }).toolName, "");
    assert.deepStrictEqual((events[0] as { output: unknown }).output, { x: 1 });
  });

  it("correlates toolCallId across multiple concurrent tool calls in one turn", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"tool-input-start","toolCallId":"tc_a","toolName":"web_search"}\n`,
      `data: {"type":"tool-input-start","toolCallId":"tc_b","toolName":"audio_compare"}\n`,
      `data: {"type":"tool-output-available","toolCallId":"tc_b","output":"audio-result"}\n`,
      `data: {"type":"tool-output-available","toolCallId":"tc_a","output":"search-result"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const events = await collect(client, "x");

    // Outputs arrived in opposite order from inputs; toolName must follow the id.
    const outputs = events.filter((e): e is ChatEvent & { type: "tool-output-available" } =>
      e.type === "tool-output-available");
    assert.strictEqual(outputs.length, 2);
    assert.strictEqual((outputs[0] as { toolName: string }).toolName, "audio_compare");
    assert.strictEqual((outputs[1] as { toolName: string }).toolName, "web_search");
  });

  it("yields an `error` event and rolls back the turn on a mid-stream error chunk", async () => {
    // Real wire format from the AI SDK when the upstream LLM call dies
    // mid-stream (gateway 402 / model 5xx / tool exception). Headers
    // are already sent (HTTP 200), so the agent server can't write a
    // JSON error envelope — only this in-band SSE chunk surfaces the
    // failure. The SDK must NOT auto-yield `done` after an error, and
    // must NOT commit the assistant message to history.
    nextResponse = () => sseResponse([
      `data: {"type":"text-delta","delta":"partial "}\n`,
      `data: {"type":"error","errorText":"Insufficient funds. Top up at https://vercel.com/..."}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const events = await collect(client, "hi");

    const types = events.map((e) => e.type);
    assert.deepStrictEqual(types, ["text-delta", "error"]);
    assert.ok(!types.includes("done"), "must not yield `done` after an error");

    const errEvent = events.find((e) => e.type === "error");
    assert.ok(errEvent && errEvent.type === "error");
    assert.match(errEvent.message, /Insufficient funds/);

    // User message rolled back — partial text never lands in history.
    assert.strictEqual(client.messages.length, 0);
  });

  it("falls back to a generic message when the error chunk has no errorText", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"error"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const events = await collect(client, "hi");
    const errEvent = events.find((e) => e.type === "error");
    assert.ok(errEvent && errEvent.type === "error");
    assert.strictEqual(errEvent.message, "stream error");
    assert.strictEqual(client.messages.length, 0);
  });

  it("rolls back the failing turn's own message when sends overlap", async () => {
    // Regression: previously the finally block did a bare `pop()`,
    // which would remove whichever message was currently last —
    // potentially another turn's user message if two sends overlapped.
    // Rollback must remove the failing turn's own userMessage by
    // reference, regardless of array position.
    //
    // Layout: turn A is in flight with a pending stream. Turn B starts
    // and runs to completion (commits user+assistant). Then A errors.
    // A's rollback must remove ONLY A's user — leaving B intact.
    let resolveA: ((res: Response) => void) | null = null;
    const aResponse = new Promise<Response>((r) => { resolveA = r; });
    let firstCall = true;
    nextResponse = () => {
      if (firstCall) {
        firstCall = false;
        // A: stream pipes from the manually-resolved response.
        return new Response(new ReadableStream({
          start(controller) {
            void aResponse.then((r) => {
              const reader = r.body!.getReader();
              const pump = (): Promise<void> => reader.read().then(({ done, value }) => {
                if (done) { controller.close(); return; }
                controller.enqueue(value);
                return pump();
              });
              void pump();
            });
          },
        }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      // B: completes immediately.
      return sseResponse([`data: {"type":"text-delta","delta":"B-reply"}\n`]);
    };

    const client = new AgentClient({ serverUrl: "http://x" });
    const aPromise = collect(client, "A"); // start, don't await

    // While A is suspended, B runs to completion.
    await collect(client, "B");

    // After B: A-user + B-user + B-assistant = 3 entries.
    assert.strictEqual(client.messages.length, 3);

    // Now finish A with an error.
    resolveA!(sseResponse([`data: {"type":"error","errorText":"oops"}\n`]));
    await aPromise;

    // A's rollback must remove A's user (idx 0) — NOT B's assistant
    // (idx 2, the actual current `pop()` target). Final: B-user, B-asst.
    assert.strictEqual(client.messages.length, 2);
    assert.strictEqual(client.messages[0]?.role, "user");
    assert.strictEqual(client.messages[0]?.parts[0]?.text, "B");
    assert.strictEqual(client.messages[1]?.role, "assistant");
  });

  it("rolls back the user message when fetch returns non-2xx", async () => {
    nextResponse = () => new Response("nope", { status: 500 });
    const client = new AgentClient({ serverUrl: "http://x" });
    await assert.rejects(() => collect(client, "hi"));
    assert.strictEqual(client.messages.length, 0);
  });

  it("rolls back the user message when the stream throws mid-flight", async () => {
    nextResponse = () => {
      let i = 0;
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i === 0) {
              controller.enqueue(enc.encode(`data: {"type":"text-delta","delta":"a"}\n`));
              i++;
            } else {
              controller.error(new Error("boom"));
            }
          },
        }),
        { status: 200 },
      );
    };
    const client = new AgentClient({ serverUrl: "http://x" });
    await assert.rejects(() => collect(client, "hi"), /boom/);
    assert.strictEqual(client.messages.length, 0);
  });

  it("rolls back the user message when the consumer breaks early", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"text-delta","delta":"a"}\n`,
      `data: {"type":"text-delta","delta":"b"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    for await (const _ev of client.send("hi")) {
      break;
    }
    assert.strictEqual(client.messages.length, 0);
  });

  it("rolls back when the abort signal fires before completion", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"text-delta","delta":"a"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => collect(client, "hi", ac.signal));
    assert.strictEqual(client.messages.length, 0);
  });

  it("reset() drops all messages", async () => {
    nextResponse = () => sseResponse([`data: {"type":"text-delta","delta":"x"}\n`]);
    const client = new AgentClient({ serverUrl: "http://x" });
    await collect(client, "hi");
    assert.strictEqual(client.messages.length, 2);
    client.reset();
    assert.strictEqual(client.messages.length, 0);
  });

  it("POSTs to /chat with the messages array as JSON", async () => {
    nextResponse = () => sseResponse([`data: {"type":"text-delta","delta":"x"}\n`]);
    const client = new AgentClient({ serverUrl: "http://localhost:2999" });
    await collect(client, "hello");

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(String(calls[0]!.url), "http://localhost:2999/chat");
    assert.strictEqual(calls[0]!.init?.method, "POST");
    const body = JSON.parse(calls[0]!.init!.body as string);
    assert.strictEqual(body.messages.length, 1);
    assert.strictEqual(body.messages[0].role, "user");
    assert.strictEqual(body.messages[0].parts[0].text, "hello");
  });

  it("exposes the in-flight user message in `messages` before the iterator is consumed", async () => {
    nextResponse = () => sseResponse([`data: {"type":"text-delta","delta":"x"}\n`]);
    const client = new AgentClient({ serverUrl: "http://x" });

    const iter = client.send("hi");
    // Iterator returned, but not consumed yet — user message must already be visible.
    assert.strictEqual(client.messages.length, 1);
    assert.strictEqual(client.messages[0]?.role, "user");
    assert.strictEqual(client.messages[0]?.parts[0]?.text, "hi");

    // Drain so we don't leave a dangling generator.
    for await (const _ev of iter) {
      // consume
    }
    assert.strictEqual(client.messages.length, 2);
  });

  it("includes prior assistant messages in the next turn's POST body", async () => {
    nextResponse = () => sseResponse([`data: {"type":"text-delta","delta":"reply1"}\n`]);
    const client = new AgentClient({ serverUrl: "http://x" });
    await collect(client, "turn1");

    nextResponse = () => sseResponse([`data: {"type":"text-delta","delta":"reply2"}\n`]);
    await collect(client, "turn2");

    assert.strictEqual(calls.length, 2);

    const body2 = JSON.parse(calls[1]!.init!.body as string);
    assert.strictEqual(body2.messages.length, 3);
    assert.strictEqual(body2.messages[0].role, "user");
    assert.strictEqual(body2.messages[0].parts[0].text, "turn1");
    assert.strictEqual(body2.messages[1].role, "assistant");
    assert.strictEqual(body2.messages[1].parts[0].text, "reply1");
    assert.strictEqual(body2.messages[2].role, "user");
    assert.strictEqual(body2.messages[2].parts[0].text, "turn2");

    assert.strictEqual(client.messages.length, 4);
  });
});
