import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

const DEFAULT_SERVER_URL = "http://localhost:3001";

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

function formatToolInput(toolName: string, input: unknown): string {
  if (input == null) return "";
  const obj = input as Record<string, unknown>;
  if (toolName === "web_search" && obj.query) {
    return `"${obj.query}"`;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";
  if (keys.length <= 3) {
    return keys.map((k) => `${k}=${JSON.stringify(obj[k])}`).join(", ");
  }
  return `${keys.length} params`;
}

async function streamChat(serverUrl: string, messages: UIMessage[]): Promise<string> {
  const response = await fetch(`${serverUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        // SSE format: "data: {json}" or "data: [DONE]"
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") continue;

        let event: { type: string; delta?: string; id?: string; toolName?: string; input?: unknown; result?: unknown };
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }

        switch (event.type) {
          case "text-delta":
            process.stdout.write(event.delta ?? "");
            assistantText += event.delta ?? "";
            break;
          case "tool-input-start":
            process.stdout.write(`\n\x1b[36m[tool: ${event.toolName}]\x1b[0m `);
            break;
          case "tool-input-available":
            process.stdout.write(formatToolInput(event.toolName ?? "", event.input));
            break;
          case "tool-output-available":
            process.stdout.write(`\x1b[32m done\x1b[0m\n`);
            break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return assistantText;
}

async function main(): Promise<void> {
  const serverUrl = process.env.AGENT_SERVER_URL ?? DEFAULT_SERVER_URL;
  const messages: UIMessage[] = [];

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`Connecting to ${serverUrl}`);
  console.log("Type a message to chat. Commands: /reset, /quit\n");

  const prompt = (): void => {
    rl.question("> ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "/quit") {
        console.log("Bye!");
        rl.close();
        process.exit(0);
      }

      if (trimmed === "/reset") {
        messages.length = 0;
        console.log("Conversation reset.\n");
        prompt();
        return;
      }

      messages.push({ id: randomUUID(), role: "user", parts: [{ type: "text", text: trimmed }] });

      const historyBytes = JSON.stringify(messages).length;
      if (historyBytes > 800_000) {
        console.log(`\x1b[33m[warning] Conversation history is ${Math.round(historyBytes / 1024)}KB — approaching server limit. Use /reset to start fresh.\x1b[0m`);
      }

      try {
        const assistantText = await streamChat(serverUrl, messages);
        messages.push({ id: randomUUID(), role: "assistant", parts: [{ type: "text", text: assistantText }] });
        console.log("\n");
      } catch (e) {
        console.error("Error:", e);
        messages.pop();
        console.log();
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);