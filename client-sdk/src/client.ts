import { parseSseStream } from "./sse-parser.js";
import type { ChatEvent, UIMessage } from "./types.js";

export interface AgentClientOptions {
  serverUrl: string;
}

export interface SendOptions {
  signal?: AbortSignal;
}

export class AgentClient {
  readonly #serverUrl: string;
  #messages: UIMessage[] = [];

  constructor(opts: AgentClientOptions) {
    this.#serverUrl = opts.serverUrl;
  }

  get messages(): readonly UIMessage[] {
    return this.#messages;
  }

  reset(): void {
    this.#messages = [];
  }

  send(text: string, opts: SendOptions = {}): AsyncIterable<ChatEvent> {
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
    };
    this.#messages.push(userMessage);
    return this.#streamResponse(opts.signal);
  }

  async *#streamResponse(signal?: AbortSignal): AsyncIterable<ChatEvent> {
    let committed = false;
    try {
      signal?.throwIfAborted();
      const response = await fetch(`${this.#serverUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: this.#messages }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const body = response.body;
      if (!body) throw new Error("No response body");

      let assistantText = "";
      // Wire format keys tool calls by `toolCallId`. The `tool-output-available`
      // event carries no `toolName`, so we track id → name from `tool-input-start`
      // and synthesize `toolName` on the output event for consumer convenience.
      const toolNamesByCallId = new Map<string, string>();

      for await (const raw of parseSseStream(body)) {
        if (typeof raw !== "object" || raw === null) continue;
        const r = raw as Record<string, unknown>;
        switch (r.type) {
          case "text-delta": {
            const delta = typeof r.delta === "string" ? r.delta : "";
            assistantText += delta;
            yield { type: "text-delta", delta };
            break;
          }
          case "tool-input-start": {
            const toolName = typeof r.toolName === "string" ? r.toolName : "";
            const toolCallId = typeof r.toolCallId === "string" ? r.toolCallId : "";
            if (toolCallId) toolNamesByCallId.set(toolCallId, toolName);
            yield { type: "tool-input-start", toolName };
            break;
          }
          case "tool-input-available": {
            const toolName = typeof r.toolName === "string" ? r.toolName : "";
            const toolCallId = typeof r.toolCallId === "string" ? r.toolCallId : "";
            if (toolCallId && toolName) toolNamesByCallId.set(toolCallId, toolName);
            yield { type: "tool-input-available", toolName, input: r.input };
            break;
          }
          case "tool-output-available": {
            const toolCallId = typeof r.toolCallId === "string" ? r.toolCallId : "";
            const toolName = toolNamesByCallId.get(toolCallId) ?? "";
            yield { type: "tool-output-available", toolName, output: r.output };
            break;
          }
        }
      }

      const assistantMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: assistantText }],
      };
      this.#messages.push(assistantMessage);
      committed = true;
      yield { type: "done", assistantText };
    } finally {
      if (!committed) {
        // Roll back the user message that was pushed at send() entry.
        this.#messages.pop();
      }
    }
  }
}
