import { createInterface } from "node:readline";
import { AgentClient, isWebSearchResult, type WebSearchResult } from "@sounds-and-recreation/agent-client";

const DEFAULT_SERVER_URL = "http://localhost:2999";

function renderSources(result: WebSearchResult): void {
  if (result.results.length === 0) return;
  process.stdout.write(`\x1b[2mSources:\x1b[0m\n`);
  for (const src of result.results) {
    process.stdout.write(`  \x1b[36m• ${src.url}\x1b[0m`);
    if (src.title) process.stdout.write(` — ${src.title}`);
    process.stdout.write(`\n`);
  }
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

async function chat(client: AgentClient, text: string): Promise<void> {
  for await (const event of client.send(text)) {
    switch (event.type) {
      case "text-delta":
        process.stdout.write(event.delta);
        break;
      case "tool-input-start":
        process.stdout.write(`\n\x1b[36m[tool: ${event.toolName}]\x1b[0m `);
        break;
      case "tool-input-available":
        process.stdout.write(formatToolInput(event.toolName, event.input));
        break;
      case "tool-output-available":
        process.stdout.write(`\x1b[32m done\x1b[0m\n`);
        if (isWebSearchResult(event.toolName, event.output)) {
          renderSources(event.output);
        }
        break;
      case "done":
        // assistant message already committed by the SDK
        break;
    }
  }
}

async function main(): Promise<void> {
  const serverUrl = process.env.AGENT_SERVER_URL ?? DEFAULT_SERVER_URL;
  const client = new AgentClient({ serverUrl });

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
        client.reset();
        console.log("Conversation reset.\n");
        prompt();
        return;
      }

      const historyBytes = JSON.stringify(client.messages).length;
      if (historyBytes > 800_000) {
        console.log(`\x1b[33m[warning] Conversation history is ${Math.round(historyBytes / 1024)}KB — approaching server limit. Use /reset to start fresh.\x1b[0m`);
      }

      try {
        await chat(client, trimmed);
        console.log("\n");
      } catch (e) {
        console.error("Error:", e);
        console.log();
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
