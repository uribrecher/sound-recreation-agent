import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpToolsToAiSdk } from "./mcp-tool-adapter.js";
import type { ToolSet } from "ai";

interface McpServerConfig {
  id: string;
  command: string;
  args: string[];
}

interface ConnectedServer {
  id: string;
  client: Client;
  transport: StdioClientTransport;
  tools: ToolSet;
}

export class McpManager {
  private servers: ConnectedServer[] = [];

  async connectAll(configs: McpServerConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      configs.map((config) => this.connectOne(config))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        console.error(`Failed to connect MCP server "${configs[i].id}":`, result.reason);
      }
    }
  }

  private async connectOne(config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
    });

    const client = new Client({
      name: "sound-recreation-agent",
      version: "0.1.0",
    });

    await client.connect(transport);
    console.log(`Connected to MCP server: ${config.id}`);

    const { tools: mcpTools } = await client.listTools();
    const aiTools = mcpToolsToAiSdk(
      mcpTools,
      async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        return result;
      }
    );

    this.servers.push({ id: config.id, client, transport, tools: aiTools });
  }

  getMergedTools(): ToolSet {
    const merged: ToolSet = {};
    for (const server of this.servers) {
      Object.assign(merged, server.tools);
    }
    return merged;
  }

  getConnectedServerIds(): string[] {
    return this.servers.map((s) => s.id);
  }

  async callTool(serverId: string, name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const server = this.servers.find((s) => s.id === serverId);
    if (!server) throw new Error(`MCP server "${serverId}" not connected`);
    return await server.client.callTool({ name, arguments: args });
  }

  async shutdown(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.transport.close();
        console.log(`Disconnected MCP server: ${server.id}`);
      } catch (e) {
        console.error(`Error disconnecting ${server.id}:`, e);
      }
    }
    this.servers = [];
  }
}
