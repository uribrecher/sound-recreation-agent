# Agent Client SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the REPL's HTTP client logic into a browser-safe TypeScript SDK at `client-sdk/`, refactor the Node REPL to consume it, and prepare it for use by the Electron app in `keyboards-mcp`.

**Architecture:** New sibling sub-package with its own `package.json` and `tsconfig.json` (no `@types/node`, `lib: [DOM, ES2022]`). Public API is one class — `AgentClient` — that owns the messages array and exposes `send(text)` returning an `AsyncIterable<ChatEvent>`. Underneath: a pure SSE parser, a thin fetch driver, and rollback-on-failure semantics for the messages array. The Node REPL becomes a thin readline+ANSI shell on top of `AgentClient`.

**Tech Stack:** TypeScript 5.5+, `node:test` + `node:assert` (zero test deps), ESLint 9 flat config, Vercel-AI-SDK-style ESM-only build, `fetch`/`ReadableStream`/`TextDecoder`/`crypto.randomUUID()` from `globalThis`.

**Spec:** [`docs/superpowers/specs/2026-05-04-client-sdk-design.md`](../specs/2026-05-04-client-sdk-design.md)

---

## File map

**New (under `client-sdk/`):**
- `package.json` — name `@sounds-and-recreation/agent-client`, ESM, `main`/`types` → `dist/index.js`/`dist/index.d.ts`
- `tsconfig.json` — `target: ES2022`, `module: ES2022`, `moduleResolution: bundler`, `lib: [DOM, ES2022]`
- `tsconfig.test.json` — extends `tsconfig.json`, adds tests, adds `@types/node`
- `eslint.config.js` — mirrors parent's flat config
- `src/types.ts` — `UIMessage`, `ChatEvent`
- `src/sse-parser.ts` — `parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<unknown>`
- `src/client.ts` — `AgentClient` class
- `src/index.ts` — barrel
- `tests/sse-parser.test.ts`
- `tests/client.test.ts`
- `README.md`

**Modified:**
- `package.json` (sound-recreation-agent root) — add `"@sounds-and-recreation/agent-client": "file:./client-sdk"` dep, add `"build:sdk"` script, chain into `build`
- `src/repl.ts` — drop inline `streamChat`, instantiate `AgentClient`, keep readline + ANSI + tool-input formatter + history-size warning
- `tests/unit/repl.test.ts` — N/A (REPL has no unit tests today; this plan does not add any — its surface is now thin glue, and the SDK tests cover protocol behavior)

---

## Task 1: Scaffold the client-sdk sub-package

**Files:**
- Create: `client-sdk/package.json`
- Create: `client-sdk/tsconfig.json`
- Create: `client-sdk/tsconfig.test.json`
- Create: `client-sdk/.gitignore`
- Create: `client-sdk/src/index.ts` (placeholder so tsc has something to compile)

- [ ] **Step 1: Create `client-sdk/package.json`**

```json
{
  "name": "@sounds-and-recreation/agent-client",
  "version": "0.1.0",
  "description": "Browser-safe TypeScript client SDK for the sound-recreation-agent HTTP server",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "lint": "eslint src/ tests/ --no-error-on-unmatched-pattern",
    "test": "find tests -name '*.test.ts' | xargs npx tsx --test"
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

- [ ] **Step 2: Create `client-sdk/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["DOM", "ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "types": []
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`"types": []` prevents auto-inclusion of `@types/node` in the compiled output. `lib: [DOM, ES2022]` gives the SDK access to browser globals (`fetch`, `ReadableStream`, `TextDecoder`, `crypto.randomUUID()`) without pulling in Node typings.

- [ ] **Step 3: Create `client-sdk/tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist-tests",
    "declaration": false,
    "sourceMap": false,
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

The test config adds `@types/node` because the tests use `node:test` and `node:assert`. Production build excludes them.

- [ ] **Step 4: Create `client-sdk/.gitignore`**

```
dist/
dist-tests/
node_modules/
```

- [ ] **Step 5: Create `client-sdk/src/index.ts` placeholder**

```ts
export {};
```

- [ ] **Step 6: Install dev deps**

Run: `cd client-sdk && npm install`
Expected: lockfile created, `node_modules/` populated, no vulnerabilities reported.

- [ ] **Step 7: Verify the build compiles**

Run: `cd client-sdk && npm run build`
Expected: `dist/index.js` and `dist/index.d.ts` produced, no errors.

- [ ] **Step 8: Commit**

```bash
git add client-sdk/package.json client-sdk/tsconfig.json client-sdk/tsconfig.test.json client-sdk/.gitignore client-sdk/src/index.ts client-sdk/package-lock.json
git commit -m "feat(client-sdk): scaffold sub-package with browser-safe tsconfig"
```

---

## Task 2: Add types

**Files:**
- Create: `client-sdk/src/types.ts`

- [ ] **Step 1: Write the types**

Create `client-sdk/src/types.ts`:

```ts
export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
}

export type ChatEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-input-start"; toolName: string }
  | { type: "tool-input-available"; toolName: string; input: unknown }
  | { type: "tool-output-available"; toolName: string; result: unknown }
  | { type: "done"; assistantText: string };
```

- [ ] **Step 2: Re-export from the barrel**

Replace `client-sdk/src/index.ts` with:

```ts
export type { UIMessage, ChatEvent } from "./types.js";
```

- [ ] **Step 3: Verify the build still compiles**

Run: `cd client-sdk && npm run build`
Expected: clean build; `dist/types.js`, `dist/types.d.ts`, `dist/index.d.ts` produced.

- [ ] **Step 4: Commit**

```bash
git add client-sdk/src/types.ts client-sdk/src/index.ts
git commit -m "feat(client-sdk): add UIMessage and ChatEvent types"
```

---

## Task 3: SSE parser — write the failing test

**Files:**
- Create: `client-sdk/tests/sse-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client-sdk/tests/sse-parser.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { parseSseStream } from "../src/sse-parser.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

async function collect(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe("parseSseStream", () => {
  it("yields a single complete event from one chunk", async () => {
    const stream = streamFromChunks([`data: {"type":"text-delta","delta":"hi"}\n`]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "hi" }]);
  });

  it("yields one event when the line is split across two chunks", async () => {
    const stream = streamFromChunks([
      `data: {"type":"text-delta","delta":"`,
      `hi"}\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "hi" }]);
  });

  it("yields multiple events from one chunk in order", async () => {
    const stream = streamFromChunks([
      `data: {"type":"text-delta","delta":"a"}\ndata: {"type":"text-delta","delta":"b"}\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [
      { type: "text-delta", delta: "a" },
      { type: "text-delta", delta: "b" },
    ]);
  });

  it("ignores `data: [DONE]` lines", async () => {
    const stream = streamFromChunks([
      `data: {"type":"text-delta","delta":"a"}\ndata: [DONE]\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "a" }]);
  });

  it("ignores lines without `data: ` prefix", async () => {
    const stream = streamFromChunks([
      `event: ping\ndata: {"type":"text-delta","delta":"a"}\n\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "a" }]);
  });

  it("skips a malformed JSON line and continues", async () => {
    const stream = streamFromChunks([
      `data: {not json}\ndata: {"type":"text-delta","delta":"after"}\n`,
    ]);
    const events = await collect(parseSseStream(stream));
    assert.deepStrictEqual(events, [{ type: "text-delta", delta: "after" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd client-sdk && npm test`
Expected: FAIL — module `../src/sse-parser.js` not found.

---

## Task 4: SSE parser — implement and pass

**Files:**
- Create: `client-sdk/src/sse-parser.ts`
- Modify: `client-sdk/src/index.ts`

- [ ] **Step 1: Implement the parser**

Create `client-sdk/src/sse-parser.ts`:

```ts
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>
): AsyncIterable<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload);
        } catch {
          // skip malformed JSON, continue with next line
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd client-sdk && npm test`
Expected: 6 tests pass.

- [ ] **Step 3: Run lint**

Run: `cd client-sdk && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add client-sdk/src/sse-parser.ts client-sdk/tests/sse-parser.test.ts
git commit -m "feat(client-sdk): SSE parser yields one event per parsed data line"
```

---

## Task 5: AgentClient — write the failing tests

**Files:**
- Create: `client-sdk/tests/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client-sdk/tests/client.test.ts`:

```ts
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { AgentClient } from "../src/client.js";
import type { ChatEvent } from "../src/types.js";

interface MockFetchCall {
  url: string | URL;
  init: RequestInit | undefined;
}

let calls: MockFetchCall[] = [];
let nextResponse: () => Response = () => new Response("");
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input as string | URL, init });
    return nextResponse();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(enc.encode(lines[i]!));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

function sseResponse(lines: string[], status = 200): Response {
  return new Response(streamFromLines(lines), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(client: AgentClient, text: string, signal?: AbortSignal): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const ev of client.send(text, signal ? { signal } : undefined)) {
    events.push(ev);
  }
  return events;
}

describe("AgentClient", () => {
  it("commits user and assistant messages on a successful stream", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"text-delta","delta":"hello"}\n`,
      `data: {"type":"text-delta","delta":" world"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://localhost:2999" });
    const events = await collect(client, "hi");

    assert.strictEqual(client.messages.length, 2);
    assert.strictEqual(client.messages[0]?.role, "user");
    assert.strictEqual(client.messages[0]?.parts[0]?.text, "hi");
    assert.strictEqual(client.messages[1]?.role, "assistant");
    assert.strictEqual(client.messages[1]?.parts[0]?.text, "hello world");

    const types = events.map((e) => e.type);
    assert.deepStrictEqual(types, ["text-delta", "text-delta", "done"]);
    const last = events.at(-1)!;
    assert.strictEqual(last.type === "done" ? last.assistantText : null, "hello world");
  });

  it("passes tool events through with original payload", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"tool-input-start","toolName":"web_search"}\n`,
      `data: {"type":"tool-input-available","toolName":"web_search","input":{"query":"a-ha"}}\n`,
      `data: {"type":"tool-output-available","toolName":"web_search","result":"ok"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const events = await collect(client, "search");

    assert.strictEqual(events[0]?.type, "tool-input-start");
    assert.strictEqual(events[1]?.type, "tool-input-available");
    assert.deepStrictEqual(
      (events[1] as { input: unknown }).input,
      { query: "a-ha" },
    );
    assert.strictEqual(events[2]?.type, "tool-output-available");
    assert.strictEqual((events[2] as { result: unknown }).result, "ok");
  });

  it("rolls back the user message when fetch returns non-2xx", async () => {
    nextResponse = () => new Response("nope", { status: 500 });
    const client = new AgentClient({ serverUrl: "http://x" });
    await assert.rejects(() => collect(client, "hi"));
    assert.strictEqual(client.messages.length, 0);
  });

  it("rolls back the user message when the stream throws mid-flight", async () => {
    nextResponse = () => {
      let i = 0;
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i === 0) {
              controller.enqueue(enc.encode(`data: {"type":"text-delta","delta":"a"}\n`));
              i++;
            } else {
              controller.error(new Error("boom"));
            }
          },
        }),
        { status: 200 },
      );
    };
    const client = new AgentClient({ serverUrl: "http://x" });
    await assert.rejects(() => collect(client, "hi"), /boom/);
    assert.strictEqual(client.messages.length, 0);
  });

  it("rolls back the user message when the consumer breaks early", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"text-delta","delta":"a"}\n`,
      `data: {"type":"text-delta","delta":"b"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    for await (const _ev of client.send("hi")) {
      break;
    }
    assert.strictEqual(client.messages.length, 0);
  });

  it("rolls back when the abort signal fires before completion", async () => {
    nextResponse = () => sseResponse([
      `data: {"type":"text-delta","delta":"a"}\n`,
    ]);
    const client = new AgentClient({ serverUrl: "http://x" });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => collect(client, "hi", ac.signal));
    assert.strictEqual(client.messages.length, 0);
  });

  it("reset() drops all messages", async () => {
    nextResponse = () => sseResponse([`data: {"type":"text-delta","delta":"x"}\n`]);
    const client = new AgentClient({ serverUrl: "http://x" });
    await collect(client, "hi");
    assert.strictEqual(client.messages.length, 2);
    client.reset();
    assert.strictEqual(client.messages.length, 0);
  });

  it("POSTs to /chat with the messages array as JSON", async () => {
    nextResponse = () => sseResponse([`data: {"type":"text-delta","delta":"x"}\n`]);
    const client = new AgentClient({ serverUrl: "http://localhost:2999" });
    await collect(client, "hello");

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(String(calls[0]!.url), "http://localhost:2999/chat");
    assert.strictEqual(calls[0]!.init?.method, "POST");
    const body = JSON.parse(calls[0]!.init!.body as string);
    assert.strictEqual(body.messages.length, 1);
    assert.strictEqual(body.messages[0].role, "user");
    assert.strictEqual(body.messages[0].parts[0].text, "hello");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client-sdk && npm test`
Expected: FAIL — module `../src/client.js` not found.

---

## Task 6: AgentClient — implement

**Files:**
- Create: `client-sdk/src/client.ts`
- Modify: `client-sdk/src/index.ts`

- [ ] **Step 1: Implement the class**

Create `client-sdk/src/client.ts`:

```ts
import { parseSseStream } from "./sse-parser.js";
import type { ChatEvent, UIMessage } from "./types.js";

export interface AgentClientOptions {
  serverUrl: string;
}

export interface SendOptions {
  signal?: AbortSignal;
}

export class AgentClient {
  readonly #serverUrl: string;
  #messages: UIMessage[] = [];

  constructor(opts: AgentClientOptions) {
    this.#serverUrl = opts.serverUrl;
  }

  get messages(): readonly UIMessage[] {
    return this.#messages;
  }

  reset(): void {
    this.#messages = [];
  }

  send(text: string, opts: SendOptions = {}): AsyncIterable<ChatEvent> {
    const userMessage: UIMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
    };
    this.#messages.push(userMessage);
    return this.#streamResponse(opts.signal);
  }

  async *#streamResponse(signal?: AbortSignal): AsyncIterable<ChatEvent> {
    let committed = false;
    try {
      const response = await fetch(`${this.#serverUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: this.#messages }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      const body = response.body;
      if (!body) throw new Error("No response body");

      let assistantText = "";

      for await (const raw of parseSseStream(body)) {
        const event = raw as ChatEvent;
        switch (event.type) {
          case "text-delta":
            assistantText += event.delta;
            yield event;
            break;
          case "tool-input-start":
          case "tool-input-available":
          case "tool-output-available":
            yield event;
            break;
        }
      }

      const assistantMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [{ type: "text", text: assistantText }],
      };
      this.#messages.push(assistantMessage);
      committed = true;
      yield { type: "done", assistantText };
    } finally {
      if (!committed) {
        // Roll back the user message that was pushed at send() entry.
        this.#messages.pop();
      }
    }
  }
}
```

A few specific calls in this code worth knowing:

- `crypto.randomUUID()` is on `globalThis` in modern browsers and Node 19+; no import needed.
- The user message is pushed in `send()` (synchronously) so `messages` reflects the in-flight request from the moment the iterator is created.
- `committed` flips to `true` only after the assistant message is pushed AND we're about to yield `done`. Any earlier exit (throw, abort, early `break` from the consumer) leaves `committed: false`, and the `finally` block pops the user message.
- Aborting `fetch` causes it to throw an `AbortError`, which propagates through the generator and triggers the same finally block.
- An early `break` from the consumer's loop calls the generator's `return()`, which runs the `finally` block — same rollback.

- [ ] **Step 2: Update the barrel**

Replace `client-sdk/src/index.ts` with:

```ts
export type { UIMessage, ChatEvent } from "./types.js";
export { AgentClient } from "./client.js";
export type { AgentClientOptions, SendOptions } from "./client.js";
```

- [ ] **Step 3: Run tests**

Run: `cd client-sdk && npm test`
Expected: all 14 tests pass (6 sse-parser + 8 client).

- [ ] **Step 4: Run lint**

Run: `cd client-sdk && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Run build**

Run: `cd client-sdk && npm run build`
Expected: clean compile; `dist/client.js`, `dist/client.d.ts`, `dist/sse-parser.js`, `dist/sse-parser.d.ts`, `dist/types.js`, `dist/types.d.ts`, `dist/index.js`, `dist/index.d.ts`.

- [ ] **Step 6: Commit**

```bash
git add client-sdk/src/client.ts client-sdk/src/index.ts client-sdk/tests/client.test.ts
git commit -m "feat(client-sdk): AgentClient with messages-array commit/rollback"
```

---

## Task 7: Add ESLint config

**Files:**
- Create: `client-sdk/eslint.config.js`

- [ ] **Step 1: Mirror the parent's flat config**

Create `client-sdk/eslint.config.js`:

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
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
    ignores: ["dist/", "dist-tests/", "node_modules/", "**/*.js", "**/*.cjs"],
  }
);
```

- [ ] **Step 2: Run lint**

Run: `cd client-sdk && npm run lint`
Expected: 0 errors. (If the parser complains about an empty catch in `sse-parser.ts`, the `allowEmptyCatch` rule above already permits it.)

- [ ] **Step 3: Commit**

```bash
git add client-sdk/eslint.config.js
git commit -m "chore(client-sdk): ESLint flat config"
```

---

## Task 8: Wire the SDK into sound-recreation-agent

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add the file dep**

In the root `package.json`, replace the current `dependencies` block:

```json
  "dependencies": {
    "@ai-sdk/gateway": "^3.0.0",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@tavily/ai-sdk": "^0.5.0",
    "ai": "^6.0.0"
  }
```

with the same plus the SDK file dep:

```json
  "dependencies": {
    "@ai-sdk/gateway": "^3.0.0",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@sounds-and-recreation/agent-client": "file:./client-sdk",
    "@tavily/ai-sdk": "^0.5.0",
    "ai": "^6.0.0"
  }
```

- [ ] **Step 2: Add a `build:sdk` script**

In the root `package.json`, replace the `scripts` block to add `build:sdk` and chain it into the main `build`:

Before:
```json
    "build": "tsc",
```

After:
```json
    "build": "npm run build:sdk && tsc",
    "build:sdk": "npm --prefix client-sdk run build",
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: `node_modules/@sounds-and-recreation/agent-client` symlinks to `../../client-sdk` (or contains the package). No errors.

- [ ] **Step 4: Verify the SDK is importable from the parent**

Run:
```bash
npx tsx -e "import('@sounds-and-recreation/agent-client').then(m => console.log(Object.keys(m)))"
```
Expected: prints `[ 'AgentClient' ]`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: depend on @sounds-and-recreation/agent-client via file: path"
```

---

## Task 9: Refactor src/repl.ts to use the SDK

**Files:**
- Modify: `src/repl.ts`

- [ ] **Step 1: Rewrite the REPL**

Replace the entire contents of `src/repl.ts` with:

```ts
import { createInterface } from "node:readline";
import { AgentClient } from "@sounds-and-recreation/agent-client";

const DEFAULT_SERVER_URL = "http://localhost:2999";

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
```

Three things changed compared to the previous REPL:

1. The inline `streamChat` function is gone — it's the SDK now.
2. The local `UIMessage` interface is gone — type comes from the SDK if needed.
3. Manual user/assistant `messages.push`/`pop` is gone — the SDK owns the array.

The `done` case is a no-op in the REPL — the SDK has already committed the assistant message by the time it yields `done`. We keep the case for exhaustive switching.

- [ ] **Step 2: Run lint on the parent project**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Run unit tests on the parent project**

Run: `npm run test:unit`
Expected: 17 tests pass (no change — REPL is not unit-tested).

- [ ] **Step 4: Type-check via build**

Run: `npm run build`
Expected: builds the SDK first (via `build:sdk`), then `tsc` on the parent. Both clean.

- [ ] **Step 5: Smoke-test the REPL end-to-end**

Open Terminal 1 and run: `npm run dev`
Expected: agent starts, logs `Web search: enabled.` (or `disabled` depending on env).

Open Terminal 2 and run: `npm run repl`
Expected: REPL connects, prints `Connecting to http://localhost:2999`. Type `hi` — agent replies. Type `/reset` — prints `Conversation reset.` Type `/quit` — exits.

If web search is enabled, also try: `Search the web: what synth was used in Take On Me by a-ha?` — confirm tool events render with `[tool: web_search]` and the tool input/output formatting still appears.

- [ ] **Step 6: Commit**

```bash
git add src/repl.ts
git commit -m "refactor(repl): consume @sounds-and-recreation/agent-client"
```

---

## Task 10: SDK README

**Files:**
- Create: `client-sdk/README.md`

- [ ] **Step 1: Write the README**

Create `client-sdk/README.md`:

````markdown
# @sounds-and-recreation/agent-client

Browser-safe TypeScript client for the sound-recreation-agent HTTP server.

Used by:
- `sound-recreation-agent`'s Node REPL (terminal client)
- `keyboards-mcp`'s Electron renderer (in-app chat client)

## Install

For sibling repos, depend via local path:

```json
{
  "dependencies": {
    "@sounds-and-recreation/agent-client": "file:../sound-recreation-agent/client-sdk"
  }
}
```

## Use

```ts
import { AgentClient } from "@sounds-and-recreation/agent-client";

const client = new AgentClient({ serverUrl: "http://localhost:2999" });

for await (const event of client.send("hello")) {
  switch (event.type) {
    case "text-delta": render(event.delta); break;
    case "tool-input-start": showSpinner(event.toolName); break;
    case "tool-output-available": hideSpinner(); break;
    case "done": /* assistant message already committed */ break;
  }
}

console.log(client.messages); // readonly UIMessage[]
client.reset();
```

## Runtime requirements

The SDK uses only browser-standard APIs:

- `fetch`
- `ReadableStream` / `getReader()`
- `TextDecoder` / `TextEncoder`
- `crypto.randomUUID()`

It works in any modern browser, in Electron renderer (with default `nodeIntegration: false`), and in Node 19+.

## Packaging note

The macOS packager that bundles `keyboards-mcp` into a `.app` cannot resolve `file:../sound-recreation-agent/client-sdk` from inside the bundled product. The packager must:

1. Run `npm run build` in `client-sdk/` to produce `dist/`.
2. Copy `client-sdk/dist/` into the bundled Electron app's resources next to the renderer bundle.
3. Rewrite the bare specifier `@sounds-and-recreation/agent-client` to a relative path (or vendor it into the renderer bundle at build time).

Until that packager exists, this caveat is recorded here so the dev-time `file:` dep does not get treated as production-ready distribution.
````

- [ ] **Step 2: Commit**

```bash
git add client-sdk/README.md
git commit -m "docs(client-sdk): README with usage and packaging caveat"
```

---

## Task 11: Final verification

- [ ] **Step 1: Lint all packages**

Run: `cd client-sdk && npm run lint && cd .. && npm run lint`
Expected: 0 errors.

- [ ] **Step 2: Unit tests, both packages**

Run: `cd client-sdk && npm test && cd .. && npm run test:unit`
Expected: client-sdk 14 pass, parent 17 pass.

- [ ] **Step 3: Build both packages**

Run: `npm run build` (root)
Expected: SDK builds first (`dist/` populated under `client-sdk/`), then parent builds. Both clean.

- [ ] **Step 4: Confirm no Node-only imports leaked into the SDK**

Run: `grep -rn "from \"node:" client-sdk/src/`
Expected: no matches.

- [ ] **Step 5: Confirm the SDK barrel exposes the documented surface**

Run: `npx tsx -e "import('@sounds-and-recreation/agent-client').then(m => console.log(Object.keys(m).sort()))"`
Expected: `[ 'AgentClient' ]` (types are not enumerable at runtime, only the class is).
