import { describe, it } from "node:test";
import assert from "node:assert";
import { isWebSearchResult } from "../src/web-search.js";

describe("isWebSearchResult", () => {
  it("accepts a well-formed result with toolName web_search", () => {
    const result = {
      query: "a-ha synth",
      answer: "Roland Juno-60.",
      results: [
        { url: "https://example.com/1", title: "Take On Me synth", content: "...", score: 0.9 },
        { url: "https://example.com/2", title: "A-ha gear", content: "..." },
      ],
    };
    assert.strictEqual(isWebSearchResult("web_search", result), true);
  });

  it("rejects when toolName is not web_search", () => {
    const result = { query: "x", results: [] };
    assert.strictEqual(isWebSearchResult("audio_compare", result), false);
    assert.strictEqual(isWebSearchResult("", result), false);
  });

  it("rejects null and non-object payloads", () => {
    assert.strictEqual(isWebSearchResult("web_search", null), false);
    assert.strictEqual(isWebSearchResult("web_search", undefined), false);
    assert.strictEqual(isWebSearchResult("web_search", "string"), false);
    assert.strictEqual(isWebSearchResult("web_search", 42), false);
  });

  it("rejects payloads missing query or results", () => {
    assert.strictEqual(isWebSearchResult("web_search", { results: [] }), false);
    assert.strictEqual(isWebSearchResult("web_search", { query: "x" }), false);
    assert.strictEqual(isWebSearchResult("web_search", { query: 1, results: [] }), false);
    assert.strictEqual(isWebSearchResult("web_search", { query: "x", results: "nope" }), false);
  });
});
