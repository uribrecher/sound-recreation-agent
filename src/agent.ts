import { streamText, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { McpManager } from "./mcp-manager.js";
import { ConversationHistory } from "./conversation.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { AgentConfig } from "./config.js";

export class Agent {
  private mcpManager = new McpManager();
  private conversation: ConversationHistory;
  private systemPrompt = "";

  constructor(private config: AgentConfig) {
    this.conversation = new ConversationHistory(config.maxHistoryMessages);
  }

  async start(): Promise<void> {
    const mcpConfigs = [];

    if (this.config.keyboardsMcpPath) {
      mcpConfigs.push({
        id: "keyboards-mcp",
        command: "node",
        args: [this.config.keyboardsMcpPath],
      });
    }

    if (this.config.audioMcpPath) {
      mcpConfigs.push({
        id: "audio-analysis-mcp",
        command: this.config.audioMcpPath,
        args: ["-m", "audio_analysis_mcp"],
      });
    }

    await this.mcpManager.connectAll(mcpConfigs);

    this.systemPrompt = buildSystemPrompt({ inventory: null, modelPrompt: null });

    console.log(`Agent started. Connected MCP servers: ${this.mcpManager.getConnectedServerIds().join(", ") || "none"}`);
  }

  chat(userMessage: string): AsyncIterable<string> {
    this.conversation.addUser(userMessage);

    const tools = this.mcpManager.getMergedTools();

    const result = streamText({
      model: gateway(this.config.llmModel),
      system: this.systemPrompt,
      messages: this.conversation.getMessages(),
      tools,
      stopWhen: stepCountIs(10),
    });

    return result.textStream;
  }

  addAssistantResponse(text: string): void {
    this.conversation.addAssistant(text);
  }

  resetConversation(): void {
    this.conversation.reset();
  }

  async shutdown(): Promise<void> {
    await this.mcpManager.shutdown();
  }
}
