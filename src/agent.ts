import { ToolLoopAgent, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { ToolSet } from "ai";
import { McpManager } from "./mcp-manager.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { AgentConfig } from "./config.js";

export interface AgentContext {
  agent: ToolLoopAgent;
  mcpManager: McpManager;
}

export async function createAgent(config: AgentConfig): Promise<AgentContext> {
  const mcpManager = new McpManager();

  const mcpConfigs = [];
  if (config.keyboardsMcpPath) {
    mcpConfigs.push({
      id: "keyboards-mcp",
      command: "node",
      args: [config.keyboardsMcpPath],
    });
  }
  if (config.audioMcpPath) {
    mcpConfigs.push({
      id: "audio-analysis-mcp",
      command: config.audioMcpPath,
      args: ["-m", "audio_analysis_mcp"],
    });
  }

  await mcpManager.connectAll(mcpConfigs);

  const systemPrompt = buildSystemPrompt({ inventory: null, modelPrompt: null });

  const tools: ToolSet = {
    ...mcpManager.getMergedTools(),
    web_search: gateway.tools.perplexitySearch(),
  };

  const agent = new ToolLoopAgent({
    model: gateway(config.llmModel),
    instructions: systemPrompt,
    tools,
    stopWhen: stepCountIs(10),
  });

  console.log(`Agent started. Connected MCP servers: ${mcpManager.getConnectedServerIds().join(", ") || "none"}`);

  return { agent, mcpManager };
}