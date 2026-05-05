export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

export type ChatEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-input-start"; toolName: string }
  | { type: "tool-input-available"; toolName: string; input: unknown }
  | { type: "tool-output-available"; toolName: string; output: unknown }
  // Mid-stream failure surfaced by the agent server (LLM gateway error,
  // tool execution crash, etc). When this fires, the turn is over —
  // `done` will NOT follow and the assistant message is NOT committed
  // to history. The renderer should display `message` and treat the
  // turn as failed without flipping the agent reachability state
  // (the HTTP server is still alive — the LLM call beneath it failed).
  | { type: "error"; message: string }
  | { type: "done"; assistantText: string };
