import { createServer } from "node:http";
import { createAgentUIStreamResponse } from "ai";
import { resolveConfig } from "./config.js";
import { createAgent } from "./agent.js";

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
  const { agent, mcpManager } = await createAgent(config);

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
      try {
        const body = await readBody(req);
        const { messages } = JSON.parse(body);

        const response = await createAgentUIStreamResponse({
          agent,
          uiMessages: messages,
        });

        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        const reader = response.body?.getReader();
        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        res.end();
      } catch (e) {
        console.error("Chat error:", e);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e) }));
        } else {
          res.end();
        }
      }
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
    await mcpManager.shutdown();
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