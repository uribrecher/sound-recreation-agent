import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveConfig } from "../../src/config.js";

describe("resolveConfig", () => {
  it("uses CLI flags over env vars", () => {
    const config = resolveConfig({
      cliFlags: { keyboardsMcpPath: "/cli/path/index.js", port: 4000 },
      env: { KEYBOARDS_MCP_PATH: "/env/path/index.js", AGENT_PORT: "3001" },
    });
    assert.strictEqual(config.keyboardsMcpPath, "/cli/path/index.js");
    assert.strictEqual(config.port, 4000);
  });

  it("falls back to env vars when CLI flags are absent", () => {
    const config = resolveConfig({
      cliFlags: {},
      env: { KEYBOARDS_MCP_PATH: "/env/path/index.js", AGENT_PORT: "3001" },
    });
    assert.strictEqual(config.keyboardsMcpPath, "/env/path/index.js");
    assert.strictEqual(config.port, 3001);
  });

  it("uses defaults when nothing is configured", () => {
    const config = resolveConfig({ cliFlags: {}, env: {} });
    assert.strictEqual(config.port, 2999);
    assert.strictEqual(config.keyboardsMcpPath, undefined);
    assert.strictEqual(config.audioMcpPath, undefined);
  });

  it("reads LLM model from env", () => {
    const config = resolveConfig({
      cliFlags: {},
      env: { LLM_MODEL: "openai/gpt-4o" },
    });
    assert.strictEqual(config.llmModel, "openai/gpt-4o");
  });

  it("AI_GATEWAY_API_KEY is read by the gateway SDK from process.env directly", () => {
    // gatewayApiKey was removed from AgentConfig — the @ai-sdk/gateway
    // package reads AI_GATEWAY_API_KEY from process.env automatically.
    const config = resolveConfig({ cliFlags: {}, env: {} });
    assert.strictEqual("gatewayApiKey" in config, false);
  });
});
