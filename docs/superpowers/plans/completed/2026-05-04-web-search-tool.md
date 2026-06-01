# Web Search Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a working `web_search` tool into the ToolLoopAgent using `@tavily/ai-sdk`, replacing the dead `gateway.tools.perplexitySearch()` TODO at `src/agent.ts:38`.

**Architecture:** A tiny factory module (`src/web-search.ts`) returns an AI SDK `tool({execute})` keyed as `web_search` when a Tavily API key is present, or `{}` when absent. The agent spreads the result into its tools object alongside MCP tools — same conditional-registration pattern already used for `keyboardsMcpPath` and `audioMcpPath`. Config gains a `tavilyApiKey` field sourced from `env.TAVILY_API_KEY`; npm scripts fetch it from 1Password.

**Tech Stack:** TypeScript 5.5+, Vercel AI SDK v6 (`ai`, `@ai-sdk/gateway`), `@tavily/ai-sdk`, `node:test`/`node:assert`.

**Spec:** [`docs/superpowers/specs/2026-05-04-web-search-tool-design.md`](../specs/2026-05-04-web-search-tool-design.md)

---

## Task 1: Add `tavilyApiKey` to AgentConfig

**Files:**
- Modify: `src/config.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/config.test.ts` inside the existing `describe("resolveConfig", ...)` block:

```ts
  it("reads TAVILY_API_KEY from env into tavilyApiKey", () => {
    const config = resolveConfig({
      cliFlags: {},
      env: { TAVILY_API_KEY: "tvly-test-key" },
    });
    assert.strictEqual(config.tavilyApiKey, "tvly-test-key");
  });

  it("tavilyApiKey is undefined when TAVILY_API_KEY is unset", () => {
    const config = resolveConfig({ cliFlags: {}, env: {} });
    assert.strictEqual(config.tavilyApiKey, undefined);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --test-name-pattern="tavilyApiKey"`
Expected: FAIL — `config.tavilyApiKey` is `undefined` even when env var is set, OR the property is missing entirely. The first new test fails on the `"tvly-test-key"` assertion.

- [ ] **Step 3: Add `tavilyApiKey` to the interface and resolver**

Modify `src/config.ts`. Replace the `AgentConfig` interface and the return object inside `resolveConfig` with:

```ts
export interface AgentConfig {
  keyboardsMcpPath: string | undefined;
  audioMcpPath: string | undefined;
  port: number;
  llmModel: string;
  tavilyApiKey: string | undefined;
}
```

And inside `resolveConfig`'s return:

```ts
  return {
    keyboardsMcpPath: cliFlags.keyboardsMcpPath ?? env.KEYBOARDS_MCP_PATH ?? undefined,
    audioMcpPath: cliFlags.audioMcpPath ?? env.AUDIO_ANALYSIS_MCP_PATH ?? undefined,
    port: cliFlags.port ?? (env.AGENT_PORT ? parseInt(env.AGENT_PORT, 10) : DEFAULTS.port),
    llmModel: env.LLM_MODEL ?? DEFAULTS.llmModel,
    tavilyApiKey: env.TAVILY_API_KEY ?? undefined,
  };
```

- [ ] **Step 4: Update existing test fixture**

The `baseConfig` literal in `tests/unit/agent.test.ts:6-11` no longer satisfies the `AgentConfig` interface. Add the new field:

```ts
const baseConfig: AgentConfig = {
  keyboardsMcpPath: undefined,
  audioMcpPath: undefined,
  port: 2999,
  llmModel: "anthropic/claude-sonnet-4-20250514",
  tavilyApiKey: undefined,
};
```

- [ ] **Step 5: Run all unit tests**

Run: `npm run test:unit`
Expected: All previous tests pass + 2 new `tavilyApiKey` tests pass. Total 14 passing.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/unit/config.test.ts tests/unit/agent.test.ts
git commit -m "feat(config): add tavilyApiKey field sourced from TAVILY_API_KEY env"
```

---

## Task 2: Install `@tavily/ai-sdk`

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the package**

Run: `npm install @tavily/ai-sdk`
Expected: Package added to `dependencies` in `package.json`. No vulnerabilities reported.

- [ ] **Step 2: Verify import works**

Run:
```bash
npx tsx -e "import('@tavily/ai-sdk').then(m => console.log(Object.keys(m)))"
```
Expected: Prints an array including `tavilySearch` (and possibly `tavilyExtract`, `tavilyCrawl`, `tavilyMap`).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @tavily/ai-sdk dependency"
```

---

## Task 3: Create `web-search.ts` factory

**Files:**
- Create: `src/web-search.ts`
- Test: `tests/unit/web-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/web-search.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { createWebSearchTool } from "../../src/web-search.js";

describe("createWebSearchTool", () => {
  it("returns an empty tool set when apiKey is undefined", () => {
    const tools = createWebSearchTool(undefined);
    assert.deepStrictEqual(Object.keys(tools), []);
  });

  it("returns an empty tool set when apiKey is an empty string", () => {
    const tools = createWebSearchTool("");
    assert.deepStrictEqual(Object.keys(tools), []);
  });

  it("registers a `web_search` tool when apiKey is provided", () => {
    const tools = createWebSearchTool("tvly-fake-key");
    assert.deepStrictEqual(Object.keys(tools), ["web_search"]);
    assert.ok(tools.web_search, "web_search tool should be a non-null value");
    assert.strictEqual(typeof tools.web_search, "object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/unit/web-search.test.ts`
Expected: FAIL — module `../../src/web-search.js` not found.

- [ ] **Step 3: Implement the factory**

Create `src/web-search.ts`:

```ts
import { tavilySearch } from "@tavily/ai-sdk";
import type { ToolSet } from "ai";

export function createWebSearchTool(apiKey: string | undefined): ToolSet {
  if (!apiKey) return {};

  return {
    web_search: tavilySearch({
      apiKey,
      searchDepth: "advanced",
      maxResults: 5,
      includeAnswer: true,
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/unit/web-search.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Run full unit suite**

Run: `npm run test:unit`
Expected: All previous tests pass + 3 new web-search tests pass.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/web-search.ts tests/unit/web-search.test.ts
git commit -m "feat: add createWebSearchTool factory backed by @tavily/ai-sdk"
```

---

## Task 4: Wire `web_search` into the agent

**Files:**
- Modify: `src/agent.ts`

- [ ] **Step 1: Update imports**

In `src/agent.ts`, add the import alongside the existing imports at the top:

```ts
import { createWebSearchTool } from "./web-search.js";
```

- [ ] **Step 2: Replace the TODO with the spread**

Replace the current `tools` block in `src/agent.ts:36-39`:

```ts
  const tools: ToolSet = {
    ...mcpManager.getMergedTools(),
    // TODO: add web search tool (perplexitySearch provider tool doesn't work with ToolLoopAgent loop)
  };
```

with:

```ts
  const tools: ToolSet = {
    ...mcpManager.getMergedTools(),
    ...createWebSearchTool(config.tavilyApiKey),
  };
```

- [ ] **Step 3: Update startup log to mention web search**

Replace the existing `console.log` at `src/agent.ts:52`:

```ts
  console.log(`Agent started. Connected MCP servers: ${mcpManager.getConnectedServerIds().join(", ") || "none"}`);
```

with:

```ts
  const webSearchStatus = config.tavilyApiKey ? "enabled" : "disabled";
  const mcpList = mcpManager.getConnectedServerIds().join(", ") || "none";
  console.log(`Agent started. Connected MCP servers: ${mcpList}. Web search: ${webSearchStatus}.`);
```

- [ ] **Step 4: Run unit tests**

Run: `npm run test:unit`
Expected: All tests pass. The existing `createAgent` tests in `tests/unit/agent.test.ts` use `tavilyApiKey: undefined`, so the `web_search` tool isn't registered and behavior is unchanged.

- [ ] **Step 5: Smoke-test agent boot with key absent**

Run: `AI_GATEWAY_API_KEY=fake npx tsx -e "import('./src/agent.js').then(m => m.createAgent({keyboardsMcpPath: undefined, audioMcpPath: undefined, port: 2999, llmModel: 'anthropic/claude-sonnet-4-20250514', tavilyApiKey: undefined}).then(({mcpManager}) => mcpManager.shutdown()))"`

Expected: Logs `Agent started. Connected MCP servers: none. Web search: disabled.` and exits cleanly.

- [ ] **Step 6: Smoke-test agent boot with key present**

Run: `AI_GATEWAY_API_KEY=fake npx tsx -e "import('./src/agent.js').then(m => m.createAgent({keyboardsMcpPath: undefined, audioMcpPath: undefined, port: 2999, llmModel: 'anthropic/claude-sonnet-4-20250514', tavilyApiKey: 'tvly-fake'}).then(({mcpManager}) => mcpManager.shutdown()))"`

Expected: Logs `Agent started. Connected MCP servers: none. Web search: enabled.` and exits cleanly. (No live Tavily call — the tool is registered but not invoked.)

- [ ] **Step 7: Run lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/agent.ts
git commit -m "feat(agent): register web_search tool when TAVILY_API_KEY is set"
```

---

## Task 5: Wire 1Password fetch into npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `dev` and `dev:full` scripts**

In `package.json`, replace these two script entries:

```json
    "dev": "AI_GATEWAY_API_KEY=$(op read 'op://<vault>/<ai-gateway-item>/credential' --account my.1password.com) tsx src/index.ts",
    "dev:full": "AI_GATEWAY_API_KEY=$(op read 'op://<vault>/<ai-gateway-item>/credential' --account my.1password.com) tsx src/index.ts -- --keyboards-mcp ../keyboards-mcp/dist/index.js --audio-mcp ../audio-analysis-mcp/.venv/bin/python",
```

with:

```json
    "dev": "AI_GATEWAY_API_KEY=$(op read 'op://<vault>/<ai-gateway-item>/credential' --account my.1password.com) TAVILY_API_KEY=$(op read 'op://<vault>/<tavily-item>/credential' --account my.1password.com) tsx src/index.ts",
    "dev:full": "AI_GATEWAY_API_KEY=$(op read 'op://<vault>/<ai-gateway-item>/credential' --account my.1password.com) TAVILY_API_KEY=$(op read 'op://<vault>/<tavily-item>/credential' --account my.1password.com) tsx src/index.ts -- --keyboards-mcp ../keyboards-mcp/dist/index.js --audio-mcp ../audio-analysis-mcp/.venv/bin/python",
```

- [ ] **Step 2: Verify the 1Password path resolves**

Run: `op read 'op://<vault>/<tavily-item>/credential' --account my.1password.com | head -c 8`
Expected: Prints the first 8 chars of the Tavily key (e.g. `tvly-xxx`). Confirms the path is correct before depending on it in `npm run dev`.

- [ ] **Step 3: Boot `npm run dev` and confirm log line**

Run: `npm run dev` (in one terminal — kill it after the startup log appears).
Expected: Server starts and logs `Agent started. Connected MCP servers: none. Web search: enabled.` Confirm the log says `enabled`, then Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(scripts): fetch TAVILY_API_KEY from 1Password in dev scripts"
```

---

## Task 6: Delete scratch investigation files

**Files:**
- Delete: `scratch/inspect-web-search.ts`
- Delete: `scratch/test-agent-generate.ts`
- Delete: `scratch/test-agent-web-search.ts`

- [ ] **Step 1: Remove the files**

`scratch/test-agent-web-search.ts` is tracked; the other two were created during investigation and are untracked. A plain `rm` plus `git add -A` handles both cases:

```bash
rm scratch/inspect-web-search.ts scratch/test-agent-generate.ts scratch/test-agent-web-search.ts
```

- [ ] **Step 2: Verify scratch dir state**

Run: `ls scratch/`
Expected: Only `tsconfig.json` remains.

- [ ] **Step 3: Commit**

```bash
git add -A scratch/
git commit -m "chore: remove web-search investigation scratch files"
```

(`git add -A` stages the deletion of the tracked file. The two untracked files are simply gone; nothing to stage for them.)

---

## Task 7: Mark TODO item complete

**Files:**
- Modify: `docs/plans/pending/todo.md`

- [ ] **Step 1: Strike-through the web-search bullet**

In `docs/plans/pending/todo.md`, replace the line:

```markdown
- Add web search tool — `gateway.tools.perplexitySearch()` is a provider-executed tool that doesn't loop with ToolLoopAgent (stops after tool call, never processes result). Replace with a custom tool: either `@perplexity-ai/ai-sdk` or `@tavily/ai-sdk` package, which provide standard `tool()` wrappers with `execute` functions that work in the agent loop.
```

with:

```markdown
- ~~Add web search tool — `gateway.tools.perplexitySearch()` is a provider-executed tool that doesn't loop with ToolLoopAgent (stops after tool call, never processes result). Replace with a custom tool: either `@perplexity-ai/ai-sdk` or `@tavily/ai-sdk` package, which provide standard `tool()` wrappers with `execute` functions that work in the agent loop.~~ (done — `@tavily/ai-sdk` registered as `web_search`, conditional on `TAVILY_API_KEY`)
```

- [ ] **Step 2: Commit**

```bash
git add docs/plans/pending/todo.md
git commit -m "docs: mark web-search todo as done"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 2: Run all unit tests**

Run: `npm run test:unit`
Expected: All tests pass — count is original 12 + 2 (config tavilyApiKey) + 3 (web-search) = 17 passing.

- [ ] **Step 3: Run TypeScript build**

Run: `npm run build`
Expected: Compiles cleanly to `dist/`.

- [ ] **Step 4: Confirm no stray TODO**

Run: `grep -n "TODO.*web search\|perplexitySearch" src/`
Expected: No matches.
