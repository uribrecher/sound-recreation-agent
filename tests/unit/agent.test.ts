import { describe, it } from "node:test";
import assert from "node:assert";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { Agent, type StreamEvent } from "../../src/agent.js";
import type { AgentConfig } from "../../src/config.js";

// Helper: consume fullStream and collect StreamEvents (same as repl.ts pattern)
async function consumeStream(
  result: ReturnType<Agent["chat"]>,
): Promise<{ events: StreamEvent[]; text: string }> {
  const events: StreamEvent[] = [];
  let currentText = "";
  let fullText = "";

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "tool-call":
        if (currentText) {
          events.push({ type: "text", text: currentText });
          currentText = "";
        }
        events.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: part.input,
        });
        break;

      case "tool-result":
        if (currentText) {
          events.push({ type: "text", text: currentText });
          currentText = "";
        }
        events.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
        });
        break;

      case "text-delta":
        currentText += part.text;
        fullText += part.text;
        break;
    }
  }

  if (currentText) {
    events.push({ type: "text", text: currentText });
  }

  return { events, text: fullText };
}

const baseConfig: AgentConfig = {
  keyboardsMcpPath: undefined,
  audioMcpPath: undefined,
  port: 3001,
  llmModel: "test-model",
  maxHistoryMessages: 40,
  gatewayApiKey: undefined,
};

function makeTextStream(text: string) {
  return simulateReadableStream({
    initialDelayInMs: null,
    chunkDelayInMs: null,
    chunks: [
      { type: "text-start" as const, id: "t1" },
      { type: "text-delta" as const, id: "t1", delta: text },
      { type: "text-end" as const, id: "t1" },
      {
        type: "finish" as const,
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: { type: "stop" as const, rawFinishReason: "end_turn" },
      },
    ],
  });
}

// Simulates a provider-executed tool: model emits tool-call, then the
// provider returns the tool-result in the same stream (no execute function needed).
function makeToolCallStream(opts: {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  result: unknown;
  prefixText: string;
}) {
  return simulateReadableStream({
    initialDelayInMs: null,
    chunkDelayInMs: null,
    chunks: [
      { type: "text-start" as const, id: "t1" },
      { type: "text-delta" as const, id: "t1", delta: opts.prefixText },
      { type: "text-end" as const, id: "t1" },
      {
        type: "tool-call" as const,
        toolCallId: opts.toolCallId,
        toolName: opts.toolName,
        input: JSON.stringify(opts.input),
      },
      {
        type: "tool-result" as const,
        toolCallId: opts.toolCallId,
        toolName: opts.toolName,
        result: opts.result,
      },
      {
        type: "finish" as const,
        usage: { inputTokens: 20, outputTokens: 10 },
        finishReason: { type: "tool-calls" as const, rawFinishReason: "tool_use" },
      },
    ],
  });
}

describe("Agent with mock LLM", () => {
  it("simple text response preserves conversation history", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({ stream: makeTextStream("The answer is 4.") }),
    });

    const agent = new Agent(baseConfig, model as any);
    await agent.start();

    const result = agent.chat("What is 2+2?");
    const { events, text } = await consumeStream(result);
    agent.addResponseFromEvents(events);

    assert.strictEqual(text, "The answer is 4.");

    const messages = agent.getMessages();
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, "user");
    assert.strictEqual(messages[0].content, "What is 2+2?");
    assert.strictEqual(messages[1].role, "assistant");

    await agent.shutdown();
  });

  it("tool call + result captured in events and history", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            stream: makeToolCallStream({
              toolCallId: "tc-1",
              toolName: "web_search",
              input: { query: "80s synths" },
              result: { results: [{ title: "Yamaha DX7" }] },
              prefixText: "Let me search.",
            }),
          };
        }
        // Step 2: after tool result, model generates final text
        return { stream: makeTextStream("The Yamaha DX7 was the most popular.") };
      },
    });

    const agent = new Agent(baseConfig, model as any);
    await agent.start();

    const result = agent.chat("Search for 80s synths");
    const { events, text } = await consumeStream(result);
    agent.addResponseFromEvents(events);

    // Verify events captured tool call and result
    const toolCalls = events.filter((e) => e.type === "tool-call");
    const toolResults = events.filter((e) => e.type === "tool-result");
    assert.strictEqual(toolCalls.length, 1);
    assert.strictEqual(toolCalls[0].toolName, "web_search");
    assert.strictEqual(toolResults.length, 1);

    // Verify text was captured (at minimum the prefix text before the tool call)
    assert.ok(text.length > 0, `should have text, got: "${text}"`);

    // Verify conversation history structure
    const messages = agent.getMessages();
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    const toolMsgs = messages.filter((m) => m.role === "tool");
    assert.ok(assistantMsgs.length >= 1);
    assert.strictEqual(toolMsgs.length, 1);

    // Tool message has proper output format
    const toolContent = toolMsgs[0].content as any[];
    assert.strictEqual(toolContent[0].type, "tool-result");
    assert.strictEqual(toolContent[0].output.type, "json");

    await agent.shutdown();
  });

  it("multi-turn after tool call — history is valid for next streamText", async () => {
    let callCount = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            stream: makeToolCallStream({
              toolCallId: "tc-1",
              toolName: "web_search",
              input: { query: "oil prices" },
              result: { price: "$83.50" },
              prefixText: "Searching.",
            }),
          };
        }
        if (callCount === 2) {
          return { stream: makeTextStream("Oil is at $83.50 per barrel.") };
        }
        // Turn 2: model answers from context
        return { stream: makeTextStream("The price is $83.50 per barrel.") };
      },
    });

    const agent = new Agent(baseConfig, model as any);
    await agent.start();

    // Turn 1
    const result1 = agent.chat("Search for oil prices");
    const { events: events1 } = await consumeStream(result1);
    agent.addResponseFromEvents(events1);

    // Turn 2 — this used to crash with MissingToolResultsError
    const result2 = agent.chat("What is the price?");
    const { events: events2, text: text2 } = await consumeStream(result2);
    agent.addResponseFromEvents(events2);

    assert.ok(text2.includes("$83.50"));

    const messages = agent.getMessages();
    const userMsgs = messages.filter((m) => m.role === "user");
    assert.strictEqual(userMsgs.length, 2);
    assert.ok(messages.length >= 5, `should have 5+ messages, got ${messages.length}`);

    await agent.shutdown();
  });

  it("conversation reset clears history", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({ stream: makeTextStream("Hello!") }),
    });

    const agent = new Agent(baseConfig, model as any);
    await agent.start();

    const result = agent.chat("Hi");
    const { events } = await consumeStream(result);
    agent.addResponseFromEvents(events);
    assert.ok(agent.getMessages().length >= 2);

    agent.resetConversation();
    assert.strictEqual(agent.getMessages().length, 0);

    await agent.shutdown();
  });

  it("addResponseFromEvents builds correct ModelMessage structure", () => {
    const agent = new Agent(baseConfig);

    const events: StreamEvent[] = [
      { type: "text", text: "I'll search." },
      { type: "tool-call", toolCallId: "tc-1", toolName: "web_search", args: { query: "test" } },
      { type: "tool-result", toolCallId: "tc-1", toolName: "web_search", output: { data: "result" } },
      { type: "text", text: "Here are the results." },
    ];

    agent.addResponseFromEvents(events);

    const messages = agent.getMessages();

    // Message 0: assistant with text + tool-call
    assert.strictEqual(messages[0].role, "assistant");
    const content0 = messages[0].content as any[];
    assert.strictEqual(content0[0].type, "text");
    assert.strictEqual(content0[0].text, "I'll search.");
    assert.strictEqual(content0[1].type, "tool-call");
    assert.strictEqual(content0[1].toolCallId, "tc-1");
    assert.strictEqual(content0[1].input.query, "test");

    // Message 1: tool with tool-result
    assert.strictEqual(messages[1].role, "tool");
    const content1 = messages[1].content as any[];
    assert.strictEqual(content1[0].type, "tool-result");
    assert.strictEqual(content1[0].output.type, "json");
    assert.deepStrictEqual(content1[0].output.value, { data: "result" });

    // Message 2: assistant with final text
    assert.strictEqual(messages[2].role, "assistant");
    const content2 = messages[2].content as any[];
    assert.strictEqual(content2[0].text, "Here are the results.");
  });
});
