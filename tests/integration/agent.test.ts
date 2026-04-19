import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { Agent, type StreamEvent } from "../../src/agent.js";
import { resolveConfig } from "../../src/config.js";

// Helper: consume fullStream and collect StreamEvents (same pattern as repl.ts)
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

function createAgent(opts: { keyboards?: boolean } = {}): Agent {
  const config = resolveConfig({
    cliFlags: opts.keyboards
      ? { keyboardsMcpPath: "../keyboards-mcp/dist/index.js" }
      : {},
    env: process.env as Record<string, string>,
  });
  return new Agent(config);
}

describe("Agent integration tests", { timeout: 60_000 }, () => {
  let agent: Agent;

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
    }
  });

  it("returns a text response for a simple question", async () => {
    agent = createAgent();
    await agent.start();

    const result = agent.chat("What is 2+2? Reply with just the number.");
    const { events, text } = await consumeStream(result);
    agent.addResponseFromEvents(events);

    // Got text back
    assert.ok(text.length > 0, "should return non-empty text");
    assert.ok(text.includes("4"), "should contain the answer 4");

    // Conversation history has user + assistant messages
    const messages = agent.getMessages();
    assert.strictEqual(messages[0].role, "user");
    assert.strictEqual(messages.length >= 2, true, "should have at least user + assistant");
    assert.strictEqual(messages[messages.length - 1].role, "assistant");
  });

  it("performs web search and captures tool results in history", async () => {
    agent = createAgent();
    await agent.start();

    const result = agent.chat(
      "Search the web for what synthesizer was used in Take On Me by a-ha. Use the web_search tool."
    );
    const { events } = await consumeStream(result);
    agent.addResponseFromEvents(events);

    // Verify tool-call and tool-result events were captured
    const toolCalls = events.filter((e) => e.type === "tool-call");
    const toolResults = events.filter((e) => e.type === "tool-result");
    assert.ok(toolCalls.length > 0, "should have at least one tool call");
    assert.ok(toolResults.length > 0, "should have at least one tool result");
    assert.strictEqual(toolCalls[0].toolName, "web_search");

    // Verify conversation history contains proper message structure
    const messages = agent.getMessages();
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    const toolMsgs = messages.filter((m) => m.role === "tool");

    assert.ok(assistantMsgs.length > 0, "should have assistant message");
    assert.ok(toolMsgs.length > 0, "should have tool message with results");

    // The assistant message should contain a tool-call part
    const assistantWithToolCall = assistantMsgs.find(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((p: any) => p.type === "tool-call"),
    );
    assert.ok(assistantWithToolCall, "assistant message should contain tool-call part");

    // The tool message should contain a tool-result part
    const toolMsg = toolMsgs[0];
    assert.ok(Array.isArray(toolMsg.content));
    const toolResultPart = (toolMsg.content as any[]).find(
      (p) => p.type === "tool-result",
    );
    assert.ok(toolResultPart, "tool message should contain tool-result part");
    assert.ok(toolResultPart.output != null, "tool result should have content");
  });

  it("multi-turn after web search — no MissingToolResultsError", async () => {
    agent = createAgent();
    await agent.start();

    // Turn 1: ask for a web search
    const result1 = agent.chat(
      "Search the web for the current price of crude oil. Use the web_search tool."
    );
    const { events: events1 } = await consumeStream(result1);
    agent.addResponseFromEvents(events1);

    // Verify turn 1 had a tool call
    const toolResults1 = events1.filter((e) => e.type === "tool-result");
    assert.ok(toolResults1.length > 0, "turn 1 should have tool results");

    // Turn 2: ask about the results — THIS is what used to crash
    const result2 = agent.chat("Based on the search results, what is the price per barrel?");
    const { events: events2, text: text2 } = await consumeStream(result2);
    agent.addResponseFromEvents(events2);

    // Should NOT have thrown — and should have a meaningful response
    assert.ok(text2.length > 0, "turn 2 should return text");

    // Conversation should now have 4+ messages (user, assistant+tool, user, assistant)
    const messages = agent.getMessages();
    assert.ok(messages.length >= 4, `should have 4+ messages, got ${messages.length}`);
  });

  it("uses MCP tool (keyboards-mcp) and preserves history", async () => {
    agent = createAgent({ keyboards: true });
    await agent.start();

    const result = agent.chat("List the available MIDI devices using the list_midi_devices tool.");
    const { events } = await consumeStream(result);
    agent.addResponseFromEvents(events);

    const toolCalls = events.filter((e) => e.type === "tool-call");
    assert.ok(toolCalls.length > 0, "should have called an MCP tool");
    assert.strictEqual(toolCalls[0].toolName, "list_midi_devices");

    const toolResults = events.filter((e) => e.type === "tool-result");
    assert.ok(toolResults.length > 0, "should have tool result from MCP");

    // Verify follow-up turn works
    const result2 = agent.chat("What did the list show?");
    const { text: text2, events: events2 } = await consumeStream(result2);
    agent.addResponseFromEvents(events2);
    assert.ok(text2.length > 0, "follow-up should return text");
  });

  it("resets conversation cleanly", async () => {
    agent = createAgent();
    await agent.start();

    // Send a message
    const result1 = agent.chat("Remember: the secret word is banana.");
    const { events: events1 } = await consumeStream(result1);
    agent.addResponseFromEvents(events1);
    assert.ok(agent.getMessages().length >= 2);

    // Reset
    agent.resetConversation();
    assert.strictEqual(agent.getMessages().length, 0);

    // Send another message — should work with no stale state
    const result2 = agent.chat("What is 1+1? Reply with just the number.");
    const { events: events2, text: text2 } = await consumeStream(result2);
    agent.addResponseFromEvents(events2);
    assert.ok(text2.includes("2"), "should answer correctly after reset");
    assert.strictEqual(agent.getMessages()[0].role, "user");
  });
});
