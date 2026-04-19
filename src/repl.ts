import { createInterface } from "node:readline";
import { resolveConfig } from "./config.js";
import { Agent, type StreamEvent } from "./agent.js";

function parseCliFlags(argv: string[]): Record<string, string | number> {
  const flags: Record<string, string | number> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--keyboards-mcp" && argv[i + 1]) {
      flags.keyboardsMcpPath = argv[++i];
    } else if (argv[i] === "--audio-mcp" && argv[i + 1]) {
      flags.audioMcpPath = argv[++i];
    } else if (argv[i] === "--port" && argv[i + 1]) {
      flags.port = parseInt(argv[++i], 10);
    }
  }
  return flags;
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

async function main(): Promise<void> {
  const cliFlags = parseCliFlags(process.argv);
  const config = resolveConfig({ cliFlags, env: process.env as Record<string, string> });
  const agent = new Agent(config);

  await agent.start();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Type a message to chat. Commands: /reset, /quit");
  console.log();

  const prompt = (): void => {
    rl.question("> ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "/quit") {
        console.log("Bye!");
        await agent.shutdown();
        rl.close();
        process.exit(0);
      }

      if (trimmed === "/reset") {
        agent.resetConversation();
        console.log("Conversation reset.\n");
        prompt();
        return;
      }

      try {
        const result = agent.chat(trimmed);
        const events: StreamEvent[] = [];
        let inText = false;
        let currentText = "";

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "tool-input-start":
              if (inText) {
                process.stdout.write("\n");
                inText = false;
              }
              // Flush accumulated text as an event
              if (currentText) {
                events.push({ type: "text", text: currentText });
                currentText = "";
              }
              process.stdout.write(`\x1b[36m[tool: ${part.toolName}]\x1b[0m `);
              break;

            case "tool-call":
              events.push({
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                args: part.input,
              });
              process.stdout.write(`${formatToolInput(part.toolName, part.input)}\n`);
              break;

            case "tool-result":
              events.push({
                type: "tool-result",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: part.output,
              });
              process.stdout.write(`\x1b[32m  done\x1b[0m\n`);
              break;

            case "tool-error":
              process.stdout.write(`\x1b[31m[error] ${part.error}\x1b[0m\n\n`);
              break;

            case "text-delta":
              process.stdout.write(part.text);
              currentText += part.text;
              inText = true;
              break;
          }
        }

        // Flush final text
        if (currentText) {
          events.push({ type: "text", text: currentText });
        }

        agent.addResponseFromEvents(events);
        console.log("\n");
      } catch (e) {
        console.error("Error:", e);
        console.log();
      }

      prompt();
    });
  };

  prompt();

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await agent.shutdown();
    rl.close();
    process.exit(0);
  });
}

main().catch(console.error);
