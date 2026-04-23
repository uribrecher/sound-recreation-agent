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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      if (line.startsWith("0:")) {
        const text = JSON.parse(line.slice(2));
        process.stdout.write(text);
        assistantText += text;
      } else if (line.startsWith("9:")) {
        const data = JSON.parse(line.slice(2));
        process.stdout.write(`\n\x1b[36m[tool: ${data.toolName}]\x1b[0m `);
      } else if (line.startsWith("a:")) {
        // Tool call delta — skip
      } else if (line.startsWith("b:")) {
        process.stdout.write(`\x1b[32mdone\x1b[0m\n`);
      } else if (line.startsWith("c:")) {
        const data = JSON.parse(line.slice(2));
        process.stdout.write(formatToolInput(data.toolName, data.args));
      }
    }
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