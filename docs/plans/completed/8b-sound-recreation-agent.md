# sound-recreation-agent Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new TypeScript repo that implements an AI agent using Vercel AI SDK, connecting to keyboards-mcp and audio-analysis-mcp via the official MCP SDK's stdio transport.

**Architecture:** HTTP server (port 3001) that spawns MCP servers as long-lived child processes at startup, merges their tools, and uses Vercel AI SDK's `streamText()` with conversation history and a system prompt embedding the recreate-sound workflow.

**Tech Stack:** TypeScript, Vercel AI SDK (`ai`), `@ai-sdk/gateway`, `@modelcontextprotocol/sdk`, node:test, ESLint

**Spec:** `../keyboards-mcp/docs/superpowers/specs/2026-04-19-multi-repo-split-design.md`

**Prerequisite:** Plan 8a (keyboards-mcp cleanup) must be complete — the parent folder `~/test/sounds-and-recreation/` must exist.

---

### Task 1: Initialize repo with TypeScript, ESLint, and CI

**Files:**
- Create: `~/test/sounds-and-recreation/sound-recreation-agent/package.json`
- Create: `~/test/sounds-and-recreation/sound-recreation-agent/tsconfig.json`
- Create: `~/test/sounds-and-recreation/sound-recreation-agent/eslint.config.js`
- Create: `~/test/sounds-and-recreation/sound-recreation-agent/.github/workflows/ci.yml`
- Create: `~/test/sounds-and-recreation/sound-recreation-agent/.gitignore`
- Create: `~/test/sounds-and-recreation/sound-recreation-agent/.env.example`

- [ ] **Step 1: Initialize git repo**

```bash
cd ~/test/sounds-and-recreation/sound-recreation-agent
git init
```

- [ ] **Step 2: Create .gitignore**

```gitignore
node_modules/
dist/
.env
```

- [ ] **Step 3: Create package.json**

```json
{
  "name": "sound-recreation-agent",
  "version": "0.1.0",
  "description": "AI agent for recreating keyboard sounds, powered by Vercel AI SDK and MCP",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "lint": "eslint src/ tests/",
    "test": "npm run test:unit",
    "test:unit": "find tests/unit -name '*.test.ts' | xargs npx tsx --test",
    "test:ci": "npm run lint && npm run test"
  },
  "dependencies": {
    "ai": "^5.0.0",
    "@ai-sdk/gateway": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.12.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.4",
    "@types/node": "^20.0.0",
    "eslint": "^9.39.4",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "typescript-eslint": "^8.58.2"
  }
}
```

**Note:** The `@ai-sdk/gateway` version is a placeholder — verify the actual package name and version against npm before running `npm install`. If it doesn't exist, replace with `@ai-sdk/anthropic`.

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Create eslint.config.js**

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "**/*.js", "**/*.cjs"],
  }
);
```

- [ ] **Step 6: Create tsconfig.test.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist-test",
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 7: Create .env.example**

```bash
# Required: Vercel AI Gateway API key
VERCEL_AI_GATEWAY_KEY=vag_...

# MCP server paths (auto-detected from sibling dirs if omitted)
# KEYBOARDS_MCP_PATH=../keyboards-mcp/dist/index.js
# AUDIO_ANALYSIS_MCP_PATH=../audio-analysis-mcp/.venv/bin/python

# Optional
# AGENT_PORT=3001
# LLM_MODEL=anthropic/claude-sonnet-4-20250514
# MAX_HISTORY_MESSAGES=40
```

- [ ] **Step 8: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
```

- [ ] **Step 9: Install dependencies and verify**

```bash
npm install
npm run lint
npm run build
```

Expected: lint passes (no source files yet), build succeeds (empty dist/).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: initialize repo with TypeScript, ESLint, and CI"
```

---

### Task 2: Config module

**Files:**
- Create: `src/config.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/config.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveConfig } from "../../src/config.js";

describe("resolveConfig", () => {
  it("uses CLI flags over env vars", () => {
    const config = resolveConfig({
      cliFlags: { keyboardsMcpPath: "/cli/path/index.js", port: 4000 },
      env: { KEYBOARDS_MCP_PATH: "/env/path/index.js", AGENT_PORT: "3001" },
    });
    assert.strictEqual(config.keyboardsMcpPath, "/cli/path/index.js");
    assert.strictEqual(config.port, 4000);
  });

  it("falls back to env vars when CLI flags are absent", () => {
    const config = resolveConfig({
      cliFlags: {},
      env: { KEYBOARDS_MCP_PATH: "/env/path/index.js", AGENT_PORT: "3001" },
    });
    assert.strictEqual(config.keyboardsMcpPath, "/env/path/index.js");
    assert.strictEqual(config.port, 3001);
  });

  it("uses defaults when nothing is configured", () => {
    const config = resolveConfig({ cliFlags: {}, env: {} });
    assert.strictEqual(config.port, 3001);
    assert.strictEqual(config.maxHistoryMessages, 40);
    assert.strictEqual(config.keyboardsMcpPath, undefined);
    assert.strictEqual(config.audioMcpPath, undefined);
  });

  it("reads LLM model from env", () => {
    const config = resolveConfig({
      cliFlags: {},
      env: { LLM_MODEL: "openai/gpt-4o" },
    });
    assert.strictEqual(config.llmModel, "openai/gpt-4o");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/unit/config.test.ts
```

Expected: FAIL — `resolveConfig` not found.

- [ ] **Step 3: Implement config.ts**

Create `src/config.ts`:

```typescript
export interface AgentConfig {
  keyboardsMcpPath: string | undefined;
  audioMcpPath: string | undefined;
  port: number;
  llmModel: string;
  maxHistoryMessages: number;
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
  maxHistoryMessages: 40,
} as const;

export function resolveConfig({ cliFlags, env }: ResolveInput): AgentConfig {
  return {
    keyboardsMcpPath: cliFlags.keyboardsMcpPath ?? env.KEYBOARDS_MCP_PATH ?? undefined,
    audioMcpPath: cliFlags.audioMcpPath ?? env.AUDIO_ANALYSIS_MCP_PATH ?? undefined,
    port: cliFlags.port ?? (env.AGENT_PORT ? parseInt(env.AGENT_PORT, 10) : DEFAULTS.port),
    llmModel: env.LLM_MODEL ?? DEFAULTS.llmModel,
    maxHistoryMessages: env.MAX_HISTORY_MESSAGES
      ? parseInt(env.MAX_HISTORY_MESSAGES, 10)
      : DEFAULTS.maxHistoryMessages,
    gatewayApiKey: env.VERCEL_AI_GATEWAY_KEY,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/unit/config.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: add config module with CLI flag and env var resolution"
```

---

### Task 3: MCP tool adapter

**Files:**
- Create: `src/mcp-tool-adapter.ts`
- Create: `tests/unit/mcp-tool-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mcp-tool-adapter.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { mcpToolsToAiSdk } from "../../src/mcp-tool-adapter.js";

describe("mcpToolsToAiSdk", () => {
  it("converts MCP tool definitions to AI SDK format", () => {
    const mockMcpTools = [
      {
        name: "set_parameters",
        description: "Set keyboard parameters",
        inputSchema: {
          type: "object" as const,
          properties: {
            parameters: { type: "array" as const },
          },
          required: ["parameters"],
        },
      },
    ];

    const mockCallTool = async (_name: string, _args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: "ok" }],
    });

    const aiTools = mcpToolsToAiSdk(mockMcpTools, mockCallTool);

    assert.ok(aiTools.set_parameters);
    assert.strictEqual(typeof aiTools.set_parameters.execute, "function");
    assert.strictEqual(aiTools.set_parameters.description, "Set keyboard parameters");
  });

  it("returns empty object for empty tool list", () => {
    const aiTools = mcpToolsToAiSdk([], async () => ({ content: [] }));
    assert.deepStrictEqual(aiTools, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/unit/mcp-tool-adapter.test.ts
```

Expected: FAIL — `mcpToolsToAiSdk` not found.

- [ ] **Step 3: Implement mcp-tool-adapter.ts**

Create `src/mcp-tool-adapter.ts`:

```typescript
import { tool, jsonSchema } from "ai";

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

type CallToolFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function mcpToolsToAiSdk(
  mcpTools: McpToolDef[],
  callTool: CallToolFn,
): Record<string, ReturnType<typeof tool>> {
  const aiTools: Record<string, ReturnType<typeof tool>> = {};

  for (const t of mcpTools) {
    aiTools[t.name] = tool({
      description: t.description ?? t.name,
      parameters: jsonSchema(t.inputSchema),
      execute: async (args) => callTool(t.name, args as Record<string, unknown>),
    });
  }

  return aiTools;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/unit/mcp-tool-adapter.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp-tool-adapter.ts tests/unit/mcp-tool-adapter.test.ts
git commit -m "feat: add MCP tool adapter (MCP tools → AI SDK format)"
```

---

### Task 4: Conversation history manager

**Files:**
- Create: `src/conversation.ts`
- Create: `tests/unit/conversation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/conversation.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { ConversationHistory } from "../../src/conversation.js";

describe("ConversationHistory", () => {
  it("appends user and assistant messages", () => {
    const history = new ConversationHistory(10);
    history.addUser("hello");
    history.addAssistant("hi there");

    const messages = history.getMessages();
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(messages[0], { role: "user", content: "hello" });
    assert.deepStrictEqual(messages[1], { role: "assistant", content: "hi there" });
  });

  it("trims oldest messages when over limit", () => {
    const history = new ConversationHistory(4);
    history.addUser("msg1");
    history.addAssistant("reply1");
    history.addUser("msg2");
    history.addAssistant("reply2");
    history.addUser("msg3");

    const messages = history.getMessages();
    // Should have trimmed to 4 messages (dropped msg1)
    assert.strictEqual(messages.length, 4);
    assert.deepStrictEqual(messages[0], { role: "assistant", content: "reply1" });
  });

  it("resets conversation", () => {
    const history = new ConversationHistory(10);
    history.addUser("hello");
    history.reset();
    assert.strictEqual(history.getMessages().length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsx --test tests/unit/conversation.test.ts
```

Expected: FAIL — `ConversationHistory` not found.

- [ ] **Step 3: Implement conversation.ts**

Create `src/conversation.ts`:

```typescript
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export class ConversationHistory {
  private messages: Message[] = [];

  constructor(private maxMessages: number) {}

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
    this.trim();
  }

  addAssistant(content: string): void {
    this.messages.push({ role: "assistant", content });
    this.trim();
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  reset(): void {
    this.messages = [];
  }

  private trim(): void {
    while (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx tsx --test tests/unit/conversation.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/conversation.ts tests/unit/conversation.test.ts
git commit -m "feat: add conversation history manager"
```

---

### Task 5: MCP manager (client lifecycle)

**Files:**
- Create: `src/mcp-manager.ts`

This module manages long-lived MCP client connections. It cannot be unit-tested without spawning real MCP servers, so we build it without tests here — it will be covered by E2E tests once keyboards-mcp is wired up.

- [ ] **Step 1: Implement mcp-manager.ts**

Create `src/mcp-manager.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpToolsToAiSdk } from "./mcp-tool-adapter.js";
import type { tool } from "ai";

interface McpServerConfig {
  id: string;
  command: string;
  args: string[];
}

interface ConnectedServer {
  id: string;
  client: Client;
  transport: StdioClientTransport;
  tools: Record<string, ReturnType<typeof tool>>;
}

export class McpManager {
  private servers: ConnectedServer[] = [];

  async connectAll(configs: McpServerConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      configs.map((config) => this.connectOne(config))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        console.error(`Failed to connect MCP server "${configs[i].id}":`, result.reason);
      }
    }
  }

  private async connectOne(config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
    });

    const client = new Client(
      { name: "sound-recreation-agent", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );

    await client.connect(transport);
    console.log(`Connected to MCP server: ${config.id}`);

    const { tools: mcpTools } = await client.listTools();
    const aiTools = mcpToolsToAiSdk(
      mcpTools,
      async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        return result;
      }
    );

    this.servers.push({ id: config.id, client, transport, tools: aiTools });
  }

  getMergedTools(): Record<string, ReturnType<typeof tool>> {
    const merged: Record<string, ReturnType<typeof tool>> = {};
    for (const server of this.servers) {
      Object.assign(merged, server.tools);
    }
    return merged;
  }

  getConnectedServerIds(): string[] {
    return this.servers.map((s) => s.id);
  }

  async shutdown(): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.transport.close();
        console.log(`Disconnected MCP server: ${server.id}`);
      } catch (e) {
        console.error(`Error disconnecting ${server.id}:`, e);
      }
    }
    this.servers = [];
  }
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/mcp-manager.ts
git commit -m "feat: add MCP manager for long-lived client connections"
```

---

### Task 6: System prompt assembly

**Files:**
- Create: `src/system-prompt.ts`
- Create: `prompts/recreate-sound.md` (copied from keyboards-mcp)
- Create: `tests/unit/system-prompt.test.ts`

- [ ] **Step 1: Copy recreate-sound.md from keyboards-mcp**

```bash
cp ~/test/sounds-and-recreation/keyboards-mcp/docs/recreate-sound.md \
   ~/test/sounds-and-recreation/sound-recreation-agent/prompts/recreate-sound.md
```

**Note:** If plan 8a has already deleted this file, retrieve it from git history:
```bash
cd ~/test/sounds-and-recreation/keyboards-mcp
git show HEAD~2:docs/recreate-sound.md > ~/test/sounds-and-recreation/sound-recreation-agent/prompts/recreate-sound.md
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/system-prompt.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildSystemPrompt } from "../../src/system-prompt.js";

describe("buildSystemPrompt", () => {
  it("includes the recreate-sound skill content", () => {
    const prompt = buildSystemPrompt({ inventory: null, modelPrompt: null });
    assert.ok(prompt.includes("recreat"), "should contain recreate-sound skill content");
  });

  it("includes keyboard inventory when provided", () => {
    const prompt = buildSystemPrompt({
      inventory: "## Pianos\n- Grand Piano\n- EP Piano",
      modelPrompt: null,
    });
    assert.ok(prompt.includes("Grand Piano"));
  });

  it("includes model-specific prompt when provided", () => {
    const prompt = buildSystemPrompt({
      inventory: null,
      modelPrompt: "Nord Electro 5D signal path: organ → effect → reverb",
    });
    assert.ok(prompt.includes("Nord Electro 5D"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx tsx --test tests/unit/system-prompt.test.ts
```

Expected: FAIL — `buildSystemPrompt` not found.

- [ ] **Step 4: Implement system-prompt.ts**

Create `src/system-prompt.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let recreateSoundSkill: string | null = null;

function loadRecreateSoundSkill(): string {
  if (recreateSoundSkill) return recreateSoundSkill;
  const skillPath = join(__dirname, "..", "prompts", "recreate-sound.md");
  recreateSoundSkill = readFileSync(skillPath, "utf-8");
  return recreateSoundSkill;
}

interface SystemPromptContext {
  inventory: string | null;
  modelPrompt: string | null;
}

export function buildSystemPrompt(context: SystemPromptContext): string {
  const sections: string[] = [];

  sections.push("You are a sound recreation agent that helps users recreate keyboard sounds from songs.");
  sections.push("You have access to keyboard control tools and audio analysis tools via MCP.");

  // Recreate-sound workflow
  const skill = loadRecreateSoundSkill();
  sections.push("## Sound Recreation Workflow\n\n" + skill);

  // Keyboard inventory
  if (context.inventory) {
    sections.push("## Available Keyboard Inventory\n\n" + context.inventory);
  }

  // Model-specific prompt
  if (context.modelPrompt) {
    sections.push("## Connected Keyboard Details\n\n" + context.modelPrompt);
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx tsx --test tests/unit/system-prompt.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/system-prompt.ts prompts/recreate-sound.md tests/unit/system-prompt.test.ts
git commit -m "feat: add system prompt assembly with recreate-sound skill"
```

---

### Task 7: HTTP server entry point

**Files:**
- Create: `src/index.ts`
- Create: `src/agent.ts`

- [ ] **Step 1: Implement agent.ts (core agent logic)**

Create `src/agent.ts`:

```typescript
import { streamText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { McpManager } from "./mcp-manager.js";
import { ConversationHistory } from "./conversation.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { AgentConfig } from "./config.js";

export class Agent {
  private mcpManager = new McpManager();
  private conversation: ConversationHistory;
  private systemPrompt = "";

  constructor(private config: AgentConfig) {
    this.conversation = new ConversationHistory(config.maxHistoryMessages);
  }

  async start(): Promise<void> {
    const mcpConfigs = [];

    if (this.config.keyboardsMcpPath) {
      mcpConfigs.push({
        id: "keyboards-mcp",
        command: "node",
        args: [this.config.keyboardsMcpPath],
      });
    }

    if (this.config.audioMcpPath) {
      mcpConfigs.push({
        id: "audio-analysis-mcp",
        command: this.config.audioMcpPath,
        args: ["-m", "audio_analysis_mcp"],
      });
    }

    await this.mcpManager.connectAll(mcpConfigs);

    // Build system prompt (inventory and model prompt will be fetched via MCP tools later)
    this.systemPrompt = buildSystemPrompt({ inventory: null, modelPrompt: null });

    console.log(`Agent started. Connected MCP servers: ${this.mcpManager.getConnectedServerIds().join(", ") || "none"}`);
  }

  chat(userMessage: string): AsyncIterable<string> {
    this.conversation.addUser(userMessage);

    const tools = this.mcpManager.getMergedTools();

    const result = streamText({
      model: gateway(this.config.llmModel),
      system: this.systemPrompt,
      messages: this.conversation.getMessages(),
      tools,
      maxSteps: 10,
    });

    return result.textStream;
  }

  addAssistantResponse(text: string): void {
    this.conversation.addAssistant(text);
  }

  resetConversation(): void {
    this.conversation.reset();
  }

  async shutdown(): Promise<void> {
    await this.mcpManager.shutdown();
  }
}
```

- [ ] **Step 2: Implement index.ts (HTTP server)**

Create `src/index.ts`:

```typescript
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
    // CORS headers
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
        const stream = agent.chat(message);
        let fullText = "";
        for await (const chunk of stream) {
          fullText += chunk;
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        agent.addAssistantResponse(fullText);
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
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Verify lint passes**

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All unit tests pass (config, mcp-tool-adapter, conversation, system-prompt).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/agent.ts
git commit -m "feat: add HTTP server and agent core with streaming chat"
```

---

### Task 8: CLAUDE.md and README

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create CLAUDE.md**

Create `CLAUDE.md`:

```markdown
# CLAUDE.md

## Build & Run

\`\`\`bash
npm run build          # tsc → dist/
npm run start          # HTTP server (port 3001)
npm run dev            # HTTP server via tsx (no build step)
\`\`\`

### CLI Flags

\`\`\`bash
npm run dev -- --keyboards-mcp ../keyboards-mcp/dist/index.js
npm run dev -- --audio-mcp ../audio-analysis-mcp/.venv/bin/python
npm run dev -- --port 4000
\`\`\`

## Linting

\`\`\`bash
npm run lint           # ESLint (src/ + tests/)
\`\`\`

## Testing

\`\`\`bash
npm test               # All tests
npm run test:unit      # Unit tests only
\`\`\`

Tests use \`node:test\` + \`node:assert\` (zero test dependencies).

## Architecture

HTTP server that uses Vercel AI SDK to orchestrate two MCP servers:

\`\`\`
Chat UI (HTTP) → Agent → streamText() → Vercel AI Gateway → LLM
                   │
          ┌────────┴────────┐
          ▼ (stdio)         ▼ (stdio)
    keyboards-mcp     audio-analysis-mcp
    (Node)            (Python)
\`\`\`

### Key modules

- **config.ts** — CLI flags, env vars, defaults (precedence: CLI > env > defaults)
- **agent.ts** — Core: conversation + streamText() + tool merging
- **mcp-manager.ts** — Long-lived MCP client lifecycle (connect, cache tools, shutdown)
- **mcp-tool-adapter.ts** — MCP tools → AI SDK tool format
- **conversation.ts** — Message history with trim-to-limit
- **system-prompt.ts** — Assembles system prompt from skill + inventory + model context

### Workspace

Part of \`~/test/sounds-and-recreation/\`:
- \`../keyboards-mcp/\` — Keyboard MCP server
- \`../audio-analysis-mcp/\` — Audio analysis MCP server (Python)
- \`../macos-packager/\` — macOS app packaging
\`\`\`

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md"
```

---

### Task 9: Verify full repo works end-to-end

- [ ] **Step 1: Run full CI check**

```bash
npm run test:ci
```

Expected: lint passes, all tests pass.

- [ ] **Step 2: Verify dev mode starts (without MCP servers)**

```bash
npm run dev
```

Expected: Agent starts, prints "Connected MCP servers: none", listens on port 3001. It should not crash when no MCP servers are configured — graceful degradation.

Hit Ctrl+C to stop.

- [ ] **Step 3: Verify dev mode with keyboards-mcp**

```bash
npm run dev -- --keyboards-mcp ../keyboards-mcp/dist/index.js
```

Expected: Agent starts, prints "Connected to MCP server: keyboards-mcp", listens on port 3001.

Hit Ctrl+C to stop.