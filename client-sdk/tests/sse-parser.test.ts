import { describe, it } from "node:test";
import assert from "node:assert";
import { parseSseStream } from "../src/sse-parser.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

async function collect(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe("parseSseStream", () => {
  it("yields a single complete event from one chunk", async () => {
    const stream = streamFromChunks([`data: {"type":"text-delta","delta":"hi"}\n`]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "hi" }]);
  });

  it("yields one event when the line is split across two chunks", async () => {
    const stream = streamFromChunks([
      `data: {"type":"text-delta","delta":"`,
      `hi"}\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "hi" }]);
  });

  it("yields multiple events from one chunk in order", async () => {
    const stream = streamFromChunks([
      `data: {"type":"text-delta","delta":"a"}\ndata: {"type":"text-delta","delta":"b"}\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [
      { type: "text-delta", delta: "a" },
      { type: "text-delta", delta: "b" },
    ]);
  });

  it("ignores `data: [DONE]` lines", async () => {
    const stream = streamFromChunks([
      `data: {"type":"text-delta","delta":"a"}\ndata: [DONE]\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "a" }]);
  });

  it("ignores lines without `data: ` prefix", async () => {
    const stream = streamFromChunks([
      `event: ping\ndata: {"type":"text-delta","delta":"a"}\n\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "a" }]);
  });

  it("skips a malformed JSON line and continues", async () => {
    const stream = streamFromChunks([
      `data: {not json}\ndata: {"type":"text-delta","delta":"after"}\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "after" }]);
  });
});
