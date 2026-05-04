import { describe, it } from "node:test";
import assert from "node:assert";
import { createWebSearchTool } from "../../src/web-search.js";

describe("createWebSearchTool", () => {
  it("returns an empty tool set when apiKey is undefined", () => {
    const tools = createWebSearchTool(undefined);
    assert.deepStrictEqual(Object.keys(tools), []);
  });

  it("returns an empty tool set when apiKey is an empty string", () => {
    const tools = createWebSearchTool("");
    assert.deepStrictEqual(Object.keys(tools), []);
  });

  it("registers a `web_search` tool when apiKey is provided", () => {
    const tools = createWebSearchTool("tvly-fake-key");
    assert.deepStrictEqual(Object.keys(tools), ["web_search"]);
    assert.ok(tools.web_search, "web_search tool should be a non-null value");
    assert.strictEqual(typeof tools.web_search, "object");
  });
});
