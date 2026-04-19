import { describe, it } from "node:test";
import assert from "node:assert";
import { ConversationHistory } from "../../src/conversation.js";

describe("ConversationHistory", () => {
  it("appends user messages and response messages", () => {
    const history = new ConversationHistory(10);
    history.addUser("hello");
    history.addResponseMessages([{ role: "assistant", content: "hi there" }]);

    const messages = history.getMessages();
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(messages[0], { role: "user", content: "hello" });
    assert.deepStrictEqual(messages[1], { role: "assistant", content: "hi there" });
  });

  it("preserves tool call and tool result messages", () => {
    const history = new ConversationHistory(10);
    history.addUser("search for synths");
    history.addResponseMessages([
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "tc1", toolName: "web_search", args: { query: "synths" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "tc1", toolName: "web_search", output: "found stuff" },
        ],
      },
      { role: "assistant", content: "Here's what I found..." },
    ]);

    const messages = history.getMessages();
    assert.strictEqual(messages.length, 4);
    assert.strictEqual(messages[1].role, "assistant");
    assert.strictEqual(messages[2].role, "tool");
    assert.strictEqual(messages[3].role, "assistant");
  });

  it("trims oldest messages when over limit", () => {
    const history = new ConversationHistory(4);
    history.addUser("msg1");
    history.addResponseMessages([{ role: "assistant", content: "reply1" }]);
    history.addUser("msg2");
    history.addResponseMessages([{ role: "assistant", content: "reply2" }]);
    history.addUser("msg3");

    const messages = history.getMessages();
    assert.strictEqual(messages.length, 4);
    assert.deepStrictEqual(messages[0], { role: "assistant", content: "reply1" });
  });

  it("resets conversation", () => {
    const history = new ConversationHistory(10);
    history.addUser("hello");
    history.reset();
    assert.strictEqual(history.getMessages().length, 0);
  });
});
