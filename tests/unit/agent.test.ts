import { describe, it } from "node:test";
import assert from "node:assert";
import { createAgent } from "../../src/agent.js";
import type { AgentConfig } from "../../src/config.js";

const baseConfig: AgentConfig = {
  keyboardsMcpPath: undefined,
  audioMcpPath: undefined,
  port: 2999,
  llmModel: "anthropic/claude-sonnet-4-20250514",
  tavilyApiKey: undefined,
};

describe("createAgent", () => {
  it("returns agent and mcpManager", async () => {
    const { agent, mcpManager } = await createAgent(baseConfig);

    assert.ok(agent, "should return a ToolLoopAgent");
    assert.ok(mcpManager, "should return a McpManager");
    assert.ok(typeof agent.stream === "function", "agent should have stream method");
    assert.ok(typeof agent.generate === "function", "agent should have generate method");

    await mcpManager.shutdown();
  });

  it("connects no MCP servers when paths are undefined", async () => {
    const { mcpManager } = await createAgent(baseConfig);

    assert.deepStrictEqual(mcpManager.getConnectedServerIds(), []);

    await mcpManager.shutdown();
  });
});