import { streamText, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { ToolSet, ModelMessage } from "ai";
import { McpManager } from "./mcp-manager.js";
import { ConversationHistory } from "./conversation.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { AgentConfig } from "./config.js";

export interface StreamEvent {
  type: "text" | "tool-call" | "tool-result";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  output?: unknown;
}

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

  chat(userMessage: string): ReturnType<typeof streamText> {
    this.conversation.addUser(userMessage);

    const tools: ToolSet = {
      ...this.mcpManager.getMergedTools(),
      web_search: gateway.tools.perplexitySearch(),
    };

    return streamText({
      model: gateway(this.config.llmModel),
      system: this.systemPrompt,
      messages: this.conversation.getMessages(),
      tools,
      stopWhen: stepCountIs(10),
    });
  }

  /**
   * Build proper ModelMessage[] from captured stream events and add to history.
   * We avoid response.messages entirely because ResponseMessage format is
   * incompatible with ModelMessage (different field names, extra metadata).
   */
  addResponseFromEvents(events: StreamEvent[]): void {
    const messages: ModelMessage[] = [];
    let currentAssistantContent: any[] = [];
    let pendingToolResults: any[] = [];

    const flushAssistant = () => {
      if (currentAssistantContent.length > 0) {
        messages.push({ role: "assistant", content: currentAssistantContent });
        currentAssistantContent = [];
      }
    };

    const flushToolResults = () => {
      if (pendingToolResults.length > 0) {
        messages.push({ role: "tool", content: pendingToolResults });
        pendingToolResults = [];
      }
    };

    for (const event of events) {
      switch (event.type) {
        case "text":
          // If we have pending tool results, flush them first — this text
          // is the model's response after processing tool results
          if (pendingToolResults.length > 0) {
            flushAssistant();
            flushToolResults();
          }
          currentAssistantContent.push({
            type: "text" as const,
            text: event.text!,
          });
          break;

        case "tool-call":
          currentAssistantContent.push({
            type: "tool-call" as const,
            toolCallId: event.toolCallId!,
            toolName: event.toolName!,
            input: event.args,
          });
          break;

        case "tool-result":
          // Flush current assistant (text + tool calls), then queue tool result
          flushAssistant();
          pendingToolResults.push({
            type: "tool-result" as const,
            toolCallId: event.toolCallId!,
            toolName: event.toolName!,
            output: typeof event.output === "string"
              ? { type: "text" as const, value: event.output }
              : { type: "json" as const, value: event.output },
          });
          break;
      }
    }

    // Flush remaining
    flushAssistant();
    flushToolResults();

    this.conversation.addResponseMessages(messages);
  }

  getMessages(): ModelMessage[] {
    return this.conversation.getMessages();
  }

  resetConversation(): void {
    this.conversation.reset();
  }

  async shutdown(): Promise<void> {
    await this.mcpManager.shutdown();
  }
}
