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
  input?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

/**
 * POST messages to /chat and parse the SSE stream.
 * Returns collected text and parsed events.
 */
async function chatViaHTTP(
  port: number,
  messages: UIMessage[],
): Promise<{ text: string; events: SSEEvent[] }> {
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

  return { text, events };
}

// --- Test suite ---

describe("Agent HTTP integration tests", { timeout: 60_000 }, () => {
  let ctx: AgentContext;
  let server: Server;
  let port: number;

  before(async () => {
    const config = resolveConfig({
      cliFlags: {},
      env: process.env as Record<string, string>,
    });
    // Use a random port to avoid conflicts
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
    server.close();
  });

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

  it("validates UIMessage format — rejects messages without id/parts", async () => {
    // Send the OLD format that caused the crash — should get 500 not a server crash
    const response = await fetch(`http://localhost:${port}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });

    assert.strictEqual(response.status, 500, "should return 500 for invalid UIMessage format");
    const body = await response.json();
    assert.ok(body.error, "should return an error message");
  });

  it("multi-turn conversation preserves context", async () => {
    const messages: UIMessage[] = [
      userMessage("Remember: the secret word is banana."),
    ];

    // Turn 1
    const { text: text1 } = await chatViaHTTP(port, messages);
    assert.ok(text1.length > 0, "turn 1 should return text");

    // Add assistant response and user follow-up
    messages.push({ id: randomUUID(), role: "assistant", parts: [{ type: "text", text: text1 }] });
    messages.push(userMessage("What is the secret word I told you?"));

    // Turn 2
    const { text: text2 } = await chatViaHTTP(port, messages);
    assert.ok(text2.toLowerCase().includes("banana"), `should remember 'banana', got: "${text2}"`);
  });
});