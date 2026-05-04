export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

export type ChatEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-input-start"; toolName: string }
  | { type: "tool-input-available"; toolName: string; input: unknown }
  | { type: "tool-output-available"; toolName: string; result: unknown }
  | { type: "done"; assistantText: string };
