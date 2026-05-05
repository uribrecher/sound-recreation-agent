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
    return this.#streamResponse(userMessage, opts.signal);
  }

  async *#streamResponse(userMessage: UIMessage, signal?: AbortSignal): AsyncIterable<ChatEvent> {
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
      let streamErrored = false;
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
          case "error": {
            // Vercel AI SDK emits `{type:"error", errorText}` into the SSE
            // stream when the underlying LLM call (or a merged sub-stream)
            // throws — typical causes: gateway 402/insufficient funds,
            // model 5xx, tool throwing inside the agent loop. The HTTP
            // response was 200 + headers already sent, so the agent
            // server's outer try/catch can't surface this — only the
            // SSE error chunk does. Mark the turn as failed so we
            // skip the auto-commit and never yield `done`.
            const message = typeof r.errorText === "string" && r.errorText.length > 0
              ? r.errorText
              : "stream error";
            streamErrored = true;
            yield { type: "error", message };
            break;
          }
        }
      }

      if (streamErrored) {
        // Leave `committed` false — the finally block rolls back the
        // user message we pushed in send(). The next retry will re-push
        // and this turn never lands in client.messages history.
        return;
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
        // Splice by reference rather than `pop()`: if two send() calls
        // overlap (or the consumer pushes other messages mid-flight),
        // `pop()` could remove the wrong entry. Identifying our own
        // message by reference makes the rollback safe regardless of
        // history mutations from other turns.
        const idx = this.#messages.indexOf(userMessage);
        if (idx >= 0) this.#messages.splice(idx, 1);
      }
    }
  }
}
