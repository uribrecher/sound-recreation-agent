import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createAgentUIStreamResponse } from "ai";
import { createAgent, type AgentContext } from "../../src/agent.js";
import { resolveConfig } from "../../src/config.js";

// --- Helpers ---

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

function userMessage(text: string): UIMessage {
  return { id: randomUUID(), role: "user", parts: [{ type: "text", text }] };
}

function assistantMessage(text: string): UIMessage {
  return { id: randomUUID(), role: "assistant", parts: [{ type: "text", text }] };
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

interface SSEEvent {
  type: string;
  delta?: string;
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

/**
 * POST messages to /chat and parse the SSE stream.
 * Returns collected text, parsed events, and tool-specific events.
 */
async function chatViaHTTP(
  port: number,
  messages: UIMessage[],
): Promise<{
  text: string;
  events: SSEEvent[];
  toolCalls: SSEEvent[];
  toolResults: SSEEvent[];
}> {
  const response = await fetch(`http://localhost:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  assert.strictEqual(response.ok, true, `HTTP ${response.status}: ${response.statusText}`);

  const reader = response.body?.getReader();
  assert.ok(reader, "response should have a body");

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const events: SSEEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;

      let event: SSEEvent;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      events.push(event);

      if (event.type === "text-delta" && event.delta) {
        text += event.delta;
      }
    }
  }

  const toolCalls = events.filter((e) => e.type === "tool-input-available");
  const toolResults = events.filter((e) => e.type === "tool-output-available");

  return { text, events, toolCalls, toolResults };
}

// --- Test suite ---

describe("Agent HTTP integration tests", { timeout: 120_000 }, () => {
  let ctx: AgentContext;
  let server: Server;
  let port: number;

  before(async () => {
    const config = resolveConfig({
      cliFlags: {
        audioMcpPath: "../audio-analysis-mcp/.venv/bin/python",
      },
      env: process.env as Record<string, string>,
    });
    port = 10000 + Math.floor(Math.random() * 50000);
    ctx = await createAgent(config);

    server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/chat") {
        try {
          const body = await readBody(req);
          const { messages } = JSON.parse(body);
          const response = await createAgentUIStreamResponse({
            agent: ctx.agent,
            uiMessages: messages,
          });
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          const reader = response.body?.getReader();
          if (reader) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          res.end();
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e) }));
          } else {
            res.end();
          }
        }
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    await new Promise<void>((resolve) => server.listen(port, resolve));
  });

  after(async () => {
    await ctx.mcpManager.shutdown();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  // --- Basic SSE format ---

  it("returns SSE text-delta events for a simple question", async () => {
    const messages = [userMessage("What is 2+2? Reply with just the number.")];
    const { text, events } = await chatViaHTTP(port, messages);

    assert.ok(text.length > 0, "should return non-empty text");
    assert.ok(text.includes("4"), `should contain the answer 4, got: "${text}"`);

    const textDeltas = events.filter((e) => e.type === "text-delta");
    assert.ok(textDeltas.length > 0, "should have text-delta events");

    const finishEvents = events.filter((e) => e.type === "finish");
    assert.ok(finishEvents.length > 0, "should have a finish event");
  });

  it("SSE stream includes start/finish lifecycle events", async () => {
    const messages = [userMessage("Say hello.")];
    const { events } = await chatViaHTTP(port, messages);

    const types = events.map((e) => e.type);
    assert.ok(types.includes("start"), "should have start event");
    assert.ok(types.includes("start-step"), "should have start-step event");
    assert.ok(types.includes("text-start"), "should have text-start event");
    assert.ok(types.includes("text-end"), "should have text-end event");
    assert.ok(types.includes("finish-step"), "should have finish-step event");
    assert.ok(types.includes("finish"), "should have finish event");
  });

  // --- UIMessage validation ---

  it("rejects messages without id/parts with 500", async () => {
    const response = await fetch(`http://localhost:${port}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });

    assert.strictEqual(response.status, 500, "should return 500 for invalid UIMessage format");
    const body = await response.json();
    assert.ok(body.error, "should return an error message");
  });

  // --- Multi-turn conversation ---

  it("preserves context across turns", async () => {
    const messages: UIMessage[] = [
      userMessage("Remember: the secret word is banana."),
    ];

    const { text: text1 } = await chatViaHTTP(port, messages);
    assert.ok(text1.length > 0, "turn 1 should return text");

    messages.push(assistantMessage(text1));
    messages.push(userMessage("What is the secret word I told you?"));

    const { text: text2 } = await chatViaHTTP(port, messages);
    assert.ok(text2.toLowerCase().includes("banana"), `should remember 'banana', got: "${text2}"`);
  });

  it("handles 3-turn conversation", async () => {
    const messages: UIMessage[] = [
      userMessage("I'm going to tell you 3 numbers. First: 42."),
    ];

    const { text: t1 } = await chatViaHTTP(port, messages);
    messages.push(assistantMessage(t1));
    messages.push(userMessage("Second number: 7."));

    const { text: t2 } = await chatViaHTTP(port, messages);
    messages.push(assistantMessage(t2));
    messages.push(userMessage("Third number: 13. What are all three numbers I told you?"));

    const { text: t3 } = await chatViaHTTP(port, messages);
    assert.ok(t3.includes("42"), `should remember 42, got: "${t3}"`);
    assert.ok(t3.includes("7"), `should remember 7, got: "${t3}"`);
    assert.ok(t3.includes("13"), `should remember 13, got: "${t3}"`);
  });

  // --- MCP tool calls ---

  it("calls audio_list_devices MCP tool and returns result", async () => {
    const messages = [
      userMessage("List the available audio input devices. Use the audio_list_devices tool."),
    ];

    const { text, toolCalls, toolResults, events } = await chatViaHTTP(port, messages);

    // Should have tool call events
    assert.ok(toolCalls.length > 0, `should have tool calls, got events: ${events.map(e => e.type).join(", ")}`);
    assert.strictEqual(toolCalls[0].toolName, "audio_list_devices");

    // Should have tool result
    assert.ok(toolResults.length > 0, "should have tool results");

    // Agent should produce text after processing tool result
    assert.ok(text.length > 0, "should have text response after tool call");
  });

  it("multi-step: tool call followed by conversation about results", async () => {
    const messages: UIMessage[] = [
      userMessage("List audio input devices using the audio_list_devices tool."),
    ];

    const { text: t1, toolCalls } = await chatViaHTTP(port, messages);
    assert.ok(toolCalls.length > 0, "turn 1 should call audio_list_devices");
    assert.ok(t1.length > 0, "turn 1 should have text");

    // Follow-up about the results
    messages.push(assistantMessage(t1));
    messages.push(userMessage("How many devices were found? Reply with just the number."));

    const { text: t2 } = await chatViaHTTP(port, messages);
    assert.ok(t2.length > 0, "turn 2 should have text");
    // Should contain a number (the device count)
    assert.ok(/\d/.test(t2), `turn 2 should contain a number, got: "${t2}"`);
  });
});