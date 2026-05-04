import { ToolLoopAgent, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { ToolSet } from "ai";
import { McpManager } from "./mcp-manager.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createWebSearchTool } from "./web-search.js";
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
    ...createWebSearchTool(config.tavilyApiKey),
  };

  const agent = new ToolLoopAgent({
    model: gateway(config.llmModel),
    instructions: systemPrompt,
    tools,
    stopWhen: stepCountIs(10),
    onStepFinish: process.env.DEBUG ? async ({ stepNumber, finishReason, toolCalls }) => {
      const toolSummary = toolCalls?.map((tc: any) => tc.toolName).join(", ") || "none";
      console.log(`[step ${stepNumber}] finish=${finishReason} tools=[${toolSummary}]`);
    } : undefined,
  });

  const webSearchStatus = config.tavilyApiKey ? "enabled" : "disabled";
  const mcpList = mcpManager.getConnectedServerIds().join(", ") || "none";
  console.log(`Agent started. Connected MCP servers: ${mcpList}. Web search: ${webSearchStatus}.`);

  return { agent, mcpManager };
}