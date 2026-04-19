import { describe, it } from "node:test";
import assert from "node:assert";
import { ConversationHistory } from "../../src/conversation.js";

describe("ConversationHistory", () => {
  it("appends user and assistant messages", () => {
    const history = new ConversationHistory(10);
    history.addUser("hello");
    history.addAssistant("hi there");

    const messages = history.getMessages();
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(messages[0], { role: "user", content: "hello" });
    assert.deepStrictEqual(messages[1], { role: "assistant", content: "hi there" });
  });

  it("trims oldest messages when over limit", () => {
    const history = new ConversationHistory(4);
    history.addUser("msg1");
    history.addAssistant("reply1");
    history.addUser("msg2");
    history.addAssistant("reply2");
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
