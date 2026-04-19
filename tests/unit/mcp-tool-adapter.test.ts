import { describe, it } from "node:test";
import assert from "node:assert";
import { mcpToolsToAiSdk } from "../../src/mcp-tool-adapter.js";

describe("mcpToolsToAiSdk", () => {
  it("converts MCP tool definitions to AI SDK format", () => {
    const mockMcpTools = [
      {
        name: "set_parameters",
        description: "Set keyboard parameters",
        inputSchema: {
          type: "object" as const,
          properties: {
            parameters: { type: "array" as const },
          },
          required: ["parameters"],
        },
      },
    ];

    const mockCallTool = async (_name: string, _args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: "ok" }],
    });

    const aiTools = mcpToolsToAiSdk(mockMcpTools, mockCallTool);

    assert.ok(aiTools.set_parameters);
    assert.strictEqual(typeof aiTools.set_parameters.execute, "function");
    assert.strictEqual(aiTools.set_parameters.description, "Set keyboard parameters");
  });

  it("returns empty object for empty tool list", () => {
    const aiTools = mcpToolsToAiSdk([], async () => ({ content: [] }));
    assert.deepStrictEqual(aiTools, {});
  });
});
