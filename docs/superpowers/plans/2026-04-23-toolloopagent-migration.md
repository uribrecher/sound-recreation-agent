# ToolLoopAgent Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate sound-recreation-agent from `streamText()` to `ToolLoopAgent`, redesign REPL as HTTP client, and connect audio-analysis-mcp.

**Architecture:** ToolLoopAgent encapsulates model, tools, system prompt, and stop conditions. HTTP server uses `createAgentUIStreamResponse()` for stateless SSE streaming. REPL becomes a thin HTTP client that parses SSE events and renders with terminal colors. Conversation state lives in the client, not the server.

**Tech Stack:** Vercel AI SDK v6 (`ai` package), `@ai-sdk/gateway`, `@modelcontextprotocol/sdk`, Node.js `node:test`

**Spec:** `docs/superpowers/specs/2026-04-23-toolloopagent-migration-design.md`

---

### Task 1: Rewrite agent.ts — ToolLoopAgent factory

**Files:**
- Modify: `src/agent.ts` (full rewrite)

- [ ] **Step 1: Write the new agent.ts**

Replace the `Agent` class with a factory function and a startup helper. The `McpManager` and system prompt stay, but `ConversationHistory`, `StreamEvent`, and `addResponseFromEvents` are deleted.

```typescript
import { ToolLoopAgent, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { ToolSet } from "ai";
import { McpManager } from "./mcp-manager.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { AgentConfig } from "./config.js";

export interface AgentContext {
  agent: ToolLoopAgent;
  mcpManager: McpManager;
}

export async function createAgent(config: AgentConfig): Promise<AgentContext> {
  const mcpManager = new McpManager();

  const mcpConfigs = [];
  if (config.keyboardsMcpPath) {
    mcpConfigs.push({
      id: "keyboards-mcp",
      command: "node",
      args: [config.keyboardsMcpPath],
    });
  }
  if (config.audioMcpPath) {
    mcpConfigs.push({
      id: "audio-analysis-mcp",
      command: config.audioMcpPath,
      args: ["-m", "audio_analysis_mcp"],
    });
  }

  await mcpManager.connectAll(mcpConfigs);

  const systemPrompt = buildSystemPrompt({ inventory: null, modelPrompt: null });

  const tools: ToolSet = {
    ...mcpManager.getMergedTools(),
    web_search: gateway.tools.perplexitySearch(),
  };

  const agent = new ToolLoopAgent({
    model: gateway(config.llmModel),
    instructions: systemPrompt,
    tools,
    stopWhen: stepCountIs(10),
  });

  console.log(`Agent started. Connected MCP servers: ${mcpManager.getConnectedServerIds().join(", ") || "none"}`);

  return { agent, mcpManager };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: May have errors from index.ts/repl.ts referencing old Agent class — that's fine, we'll fix those next.

- [ ] **Step 3: Commit**

```bash
git add src/agent.ts
git commit -m "refactor: replace Agent class with ToolLoopAgent factory"
```

---

### Task 2: Rewrite index.ts — createAgentUIStreamResponse

**Files:**
- Modify: `src/index.ts` (full rewrite)

- [ ] **Step 1: Write the new index.ts**

Replace manual SSE streaming with `createAgentUIStreamResponse`. The server becomes stateless — no conversation history.

```typescript
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
      const body = await readBody(req);
      const { messages } = JSON.parse(body);

      const response = createAgentUIStreamResponse({
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: May still error on repl.ts — next task.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: replace manual SSE with createAgentUIStreamResponse"
```

---

### Task 3: Rewrite repl.ts — HTTP client with SSE parsing

**Files:**
- Modify: `src/repl.ts` (full rewrite)

- [ ] **Step 1: Write the new repl.ts**

The REPL becomes a standalone HTTP client. It maintains conversation history locally and POSTs the full message array to the server. It parses SSE events and renders tool calls with terminal colors.

Note: the exact SSE event format from `createAgentUIStreamResponse` needs to be discovered at runtime. The Vercel AI SDK uses a data stream protocol. The REPL should parse the protocol's event types. Start with this implementation and iterate based on actual events received.

```typescript
import { createInterface } from "node:readline";

const DEFAULT_SERVER_URL = "http://localhost:3001";

interface UIMessage {
  role: "user" | "assistant";
  content: string;
  toolInvocations?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    state: string;
    result?: unknown;
  }>;
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

    // Parse SSE-style lines from the data stream protocol
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      // Vercel AI SDK data stream protocol uses typed prefixes
      // Format: "N:value" where N is a type code
      // 0: text delta, 9: tool call begin, a: tool call delta, b: tool result, etc.
      // See: https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol

      if (line.startsWith("0:")) {
        // Text delta — value is a JSON string
        const text = JSON.parse(line.slice(2));
        process.stdout.write(text);
        assistantText += text;
      } else if (line.startsWith("9:")) {
        // Tool call begin
        const data = JSON.parse(line.slice(2));
        process.stdout.write(`\n\x1b[36m[tool: ${data.toolName}]\x1b[0m `);
      } else if (line.startsWith("a:")) {
        // Tool call delta (streaming args) — skip for now
      } else if (line.startsWith("b:")) {
        // Tool call result
        process.stdout.write(`\x1b[32mdone\x1b[0m\n`);
      } else if (line.startsWith("c:")) {
        // Tool call args complete
        const data = JSON.parse(line.slice(2));
        process.stdout.write(formatToolInput(data.toolName, data.args));
      } else if (line.startsWith("e:")) {
        // Finish — message complete
      } else if (line.startsWith("d:")) {
        // Finish step
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

      messages.push({ role: "user", content: trimmed });

      try {
        const assistantText = await streamChat(serverUrl, messages);
        messages.push({ role: "assistant", content: assistantText });
        console.log("\n");
      } catch (e) {
        console.error("Error:", e);
        // Remove the user message that failed
        messages.pop();
        console.log();
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
```

**Important:** The SSE event format codes above (0, 9, a, b, c, d, e) are based on the Vercel AI SDK data stream protocol. These may need adjustment during testing — run the server, send a message from the REPL, and log raw lines to discover the exact format. The protocol is documented at `https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol`.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no more imports from old Agent class)

- [ ] **Step 3: Commit**

```bash
git add src/repl.ts
git commit -m "refactor: rewrite REPL as HTTP client with SSE parsing"
```

---

### Task 4: Delete conversation.ts and clean up config.ts

**Files:**
- Delete: `src/conversation.ts`
- Modify: `src/config.ts` (remove `maxHistoryMessages`, add server URL)

- [ ] **Step 1: Delete conversation.ts**

```bash
rm src/conversation.ts
```

- [ ] **Step 2: Update config.ts**

Remove `maxHistoryMessages` (no longer needed — conversation is client-side). Add `serverUrl` for REPL mode.

```typescript
export interface AgentConfig {
  keyboardsMcpPath: string | undefined;
  audioMcpPath: string | undefined;
  port: number;
  llmModel: string;
  gatewayApiKey: string | undefined;
}

interface CliFlags {
  keyboardsMcpPath?: string;
  audioMcpPath?: string;
  port?: number;
}

interface ResolveInput {
  cliFlags: CliFlags;
  env: Record<string, string | undefined>;
}

const DEFAULTS = {
  port: 3001,
  llmModel: "anthropic/claude-sonnet-4-20250514",
} as const;

export function resolveConfig({ cliFlags, env }: ResolveInput): AgentConfig {
  return {
    keyboardsMcpPath: cliFlags.keyboardsMcpPath ?? env.KEYBOARDS_MCP_PATH ?? undefined,
    audioMcpPath: cliFlags.audioMcpPath ?? env.AUDIO_ANALYSIS_MCP_PATH ?? undefined,
    port: cliFlags.port ?? (env.AGENT_PORT ? parseInt(env.AGENT_PORT, 10) : DEFAULTS.port),
    llmModel: env.LLM_MODEL ?? DEFAULTS.llmModel,
    gatewayApiKey: env.AI_GATEWAY_API_KEY,
  };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git rm src/conversation.ts
git add src/config.ts
git commit -m "refactor: delete ConversationHistory, clean up config"
```

---

### Task 5: Update package.json scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update scripts**

Update `repl` to be a simple client (no API key needed). Add `dev:full` for both MCP servers.

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "AI_GATEWAY_API_KEY=$(op read 'op://Private/vercel ai api-gateway key/password' --account my.1password.com) tsx src/index.ts",
    "dev:full": "AI_GATEWAY_API_KEY=$(op read 'op://Private/vercel ai api-gateway key/password' --account my.1password.com) tsx src/index.ts -- --keyboards-mcp ../keyboards-mcp/dist/index.js --audio-mcp ../audio-analysis-mcp/.venv/bin/python",
    "repl": "tsx src/repl.ts",
    "lint": "eslint src/ tests/ --no-error-on-unmatched-pattern",
    "test": "npm run test:unit",
    "test:unit": "find tests/unit -name '*.test.ts' | xargs npx tsx --test",
    "test:integration": "AI_GATEWAY_API_KEY=$(op read 'op://Private/vercel ai api-gateway key/password' --account my.1password.com) npx tsx --test tests/integration/agent.test.ts",
    "test:ci": "npm run lint && npm run test"
  }
}
```

Key changes:
- `repl` no longer needs `AI_GATEWAY_API_KEY` — it's just an HTTP client
- `repl:keyboards` removed — server handles MCP connections, not the REPL
- `dev:full` added for starting with both MCP servers

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: update scripts for REPL client and dev:full"
```

---

### Task 6: Update tests

**Files:**
- Delete: `tests/unit/conversation.test.ts`
- Modify: `tests/unit/agent.test.ts` (rewrite)
- Modify: `tests/unit/config.test.ts` (remove maxHistoryMessages tests)

- [ ] **Step 1: Delete conversation test**

```bash
rm tests/unit/conversation.test.ts
```

- [ ] **Step 2: Rewrite agent.test.ts**

The new agent.ts exports a `createAgent` factory. Tests verify the factory returns a valid `AgentContext` with a `ToolLoopAgent` and `McpManager`. We can't easily unit-test ToolLoopAgent behavior without a mock model, so focus on verifying the wiring.

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { createAgent } from "../../src/agent.js";
import type { AgentConfig } from "../../src/config.js";

const baseConfig: AgentConfig = {
  keyboardsMcpPath: undefined,
  audioMcpPath: undefined,
  port: 3001,
  llmModel: "anthropic/claude-sonnet-4-20250514",
  gatewayApiKey: undefined,
};

describe("createAgent", () => {
  it("returns agent and mcpManager", async () => {
    const { agent, mcpManager } = await createAgent(baseConfig);

    assert.ok(agent, "should return a ToolLoopAgent");
    assert.ok(mcpManager, "should return a McpManager");
    assert.ok(typeof agent.stream === "function", "agent should have stream method");
    assert.ok(typeof agent.generate === "function", "agent should have generate method");

    await mcpManager.shutdown();
  });

  it("connects no MCP servers when paths are undefined", async () => {
    const { mcpManager } = await createAgent(baseConfig);

    assert.deepStrictEqual(mcpManager.getConnectedServerIds(), []);

    await mcpManager.shutdown();
  });
});
```

- [ ] **Step 3: Update config.test.ts if needed**

Check if `tests/unit/config.test.ts` tests `maxHistoryMessages`. If so, remove those assertions since the field no longer exists.

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git rm tests/unit/conversation.test.ts
git add tests/unit/agent.test.ts tests/unit/config.test.ts
git commit -m "test: update tests for ToolLoopAgent migration"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture and run commands**

Update the architecture diagram and commands to reflect:
- ToolLoopAgent instead of streamText
- REPL as HTTP client (separate terminal)
- `npm run dev:full` for both MCP servers
- `npm run repl` connects to localhost:3001
- Removed: conversation.ts module description
- Updated: agent.ts module description (factory function, not class)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for ToolLoopAgent architecture"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Build and lint**

```bash
npm run build
npm run lint
npm run test:unit
```

Expected: All pass.

- [ ] **Step 2: Start server with audio-analysis-mcp**

```bash
npm run dev -- --audio-mcp ../audio-analysis-mcp/.venv/bin/python
```

Expected: Server starts, logs "Connected to MCP server: audio-analysis-mcp".

- [ ] **Step 3: Connect REPL and test basic chat**

In a separate terminal:
```bash
npm run repl
```

Type: "What is 2+2?"
Expected: Streamed text response with the answer.

- [ ] **Step 4: Test tool call rendering**

Type: "List the available audio devices"
Expected: 
- Cyan `[tool: audio_list_devices]` label appears
- Green `done` after result
- Text response listing the devices

- [ ] **Step 5: Test conversation continuity**

Type: "How many devices did you find?"
Expected: Agent remembers the previous response and answers correctly.

- [ ] **Step 6: Test reset**

Type: `/reset`
Expected: "Conversation reset." — next message has no prior context.

- [ ] **Step 7: Iterate on SSE parsing**

If the REPL doesn't render tool calls correctly, log raw SSE lines to discover the actual format from `createAgentUIStreamResponse`. Update the parsing logic in `repl.ts` accordingly. The type codes (0, 9, a, b, c, d, e) are based on the documented data stream protocol but may need adjustment.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjust SSE parsing based on runtime testing"
```