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

      for await (const raw of parseSseStream(body)) {
        const event = raw as ChatEvent;
        switch (event.type) {
          case "text-delta":
            assistantText += event.delta;
            yield event;
            break;
          case "tool-input-start":
          case "tool-input-available":
          case "tool-output-available":
            yield event;
            break;
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
