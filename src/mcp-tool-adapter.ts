import { dynamicTool, jsonSchema, type ToolSet } from "ai";

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

type CallToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function mcpToolsToAiSdk(
  mcpTools: McpToolDef[],
  callTool: CallToolFn,
): ToolSet {
  const aiTools: ToolSet = {};

  for (const t of mcpTools) {
    aiTools[t.name] = dynamicTool({
      description: t.description ?? t.name,
      inputSchema: jsonSchema(t.inputSchema),
      execute: async (args) => callTool(t.name, args as Record<string, unknown>),
    });
  }

  return aiTools;
}
