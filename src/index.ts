import { createServer } from "node:http";
import { resolveConfig } from "./config.js";
import { Agent } from "./agent.js";

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

async function main(): Promise<void> {
  const cliFlags = parseCliFlags(process.argv);
  const config = resolveConfig({ cliFlags, env: process.env as Record<string, string> });
  const agent = new Agent(config);

  await agent.start();

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/chat") {
      const body = await readBody(req);
      const { message } = JSON.parse(body);

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });

      try {
        const result = agent.chat(message);
        const events: import("./agent.js").StreamEvent[] = [];
        let currentText = "";
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
            currentText += part.text;
          } else if (part.type === "tool-call") {
            if (currentText) { events.push({ type: "text", text: currentText }); currentText = ""; }
            events.push({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName, args: part.input });
          } else if (part.type === "tool-result") {
            events.push({ type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName, output: part.output });
          }
        }
        if (currentText) { events.push({ type: "text", text: currentText }); }
        agent.addResponseFromEvents(events);
      } catch (e) {
        res.write(`data: ${JSON.stringify({ error: String(e) })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/reset") {
      agent.resetConversation();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(config.port, () => {
    console.log(`Sound Recreation Agent listening on http://localhost:${config.port}`);
  });

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await agent.shutdown();
    server.close();
    process.exit(0);
  });
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

main().catch(console.error);
