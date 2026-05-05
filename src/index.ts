import { createServer } from "node:http";
import { createAgentUIStreamResponse } from "ai";
import { resolveConfig } from "./config.js";
import { createAgent } from "./agent.js";

interface CliFlags {
  keyboardsMcpPath?: string;
  audioMcpPath?: string;
  port?: number;
}

function parseCliFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {};
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

function isValidUIMessage(msg: unknown): boolean {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return typeof m.id === "string" && typeof m.role === "string" && Array.isArray(m.parts);
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

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && req.url === "/chat") {
      try {
        const body = await readBody(req, 1024 * 1024); // 1MB limit
        let parsed: { messages?: unknown };
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }
        const { messages } = parsed;
        if (!Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "messages must be a non-empty array" }));
          return;
        }
        if (!messages.every(isValidUIMessage)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Each message must have id (string), role (string), and parts (array)" }));
          return;
        }

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
          const status = e instanceof Error && e.message === "Request body too large" ? 413 : 500;
          res.writeHead(status, { "Content-Type": "application/json" });
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

function readBody(req: import("node:http").IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

main().catch(console.error);