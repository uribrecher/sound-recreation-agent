import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSystemPrompt } from "../../src/system-prompt.js";

describe("buildSystemPrompt", () => {
  it("includes the recreate-sound skill content", () => {
    const prompt = buildSystemPrompt({ inventory: null, modelPrompt: null });
    assert.ok(prompt.includes("recreat"), "should contain recreate-sound skill content");
  });

  it("includes keyboard inventory when provided", () => {
    const prompt = buildSystemPrompt({
      inventory: "## Pianos\n- Grand Piano\n- EP Piano",
      modelPrompt: null,
    });
    assert.ok(prompt.includes("Grand Piano"));
  });

  it("includes model-specific prompt when provided", () => {
    const prompt = buildSystemPrompt({
      inventory: null,
      modelPrompt: "Nord Electro 5D signal path: organ → effect → reverb",
    });
    assert.ok(prompt.includes("Nord Electro 5D"));
  });
});
