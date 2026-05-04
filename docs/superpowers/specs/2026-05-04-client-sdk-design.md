# Agent Client SDK — Design

**Date:** 2026-05-04
**Status:** Approved (brainstorm)
**Builds on:** Existing REPL at `src/repl.ts`, server stream at `src/index.ts`

## Problem

The REPL is the only chat client today. It works for terminal testing but is a single 150-line Node-only file:

- `node:readline`, `node:crypto`, `process.stdout.write`, ANSI escapes (Node-bound)
- inline SSE parser, message-history management, tool-input formatter (mixed concerns)

To embed a chat client in the existing Electron app at `keyboards-mcp/src/mock-runner/shell/`, the streaming and history logic must be extractable as a browser-safe module. The Electron renderer cannot import `node:*` and has its own UI conventions.

## Solution

A new sibling sub-package `sound-recreation-agent/client-sdk/` with its own `package.json` + `tsconfig.json`, built to ESM `dist/`. Browser-safe only — uses `fetch`, `TextDecoder`, `ReadableStream`, and `crypto.randomUUID()` from `globalThis`. Compiled with `"lib": ["DOM", "ES2022"]`, no `@types/node`.

The Node REPL is refactored to consume the SDK and add only the Node-flavored shell (readline, ANSI colors, stdout writes, history-size warning). The Electron consumer in `keyboards-mcp` adds `"@sounds-and-recreation/agent-client": "file:../sound-recreation-agent/client-sdk"` and its renderer uses the same async-iterator API.

## Distribution

**Decision: A — sibling sub-package with `file:` dep.** Local-path is simple for two consumers, matches the workspace's "independent repos" stance, and keeps consumers' import surface clean (`from "@sounds-and-recreation/agent-client"`).

The macOS-packager will eventually need to copy `client-sdk/dist/` next to `keyboards-mcp`'s renderer bundle and rewrite the bare specifier. That step is documented in `client-sdk/README.md` and deferred to the packager's plan; not in scope for this work.

Rejected:
- **npm workspace** — over-engineered for two consumers; would touch all three repos.
- **Inline source-copy with a build step** — saves no work and loses type defs at the consumer.

## Public API

```ts
// types.ts
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

// client.ts
export interface AgentClientOptions {
  serverUrl: string;
}

export interface SendOptions {
  signal?: AbortSignal;
}

export class AgentClient {
  constructor(opts: AgentClientOptions);

  /** Read-only snapshot of the current conversation. */
  get messages(): readonly UIMessage[];

  /**
   * Append a user message and stream the assistant's response.
   * - On `done` event: assistant message is committed to messages.
   * - On thrown error or early `break`: user message is rolled back.
   */
  send(text: string, opts?: SendOptions): AsyncIterable<ChatEvent>;

  /** Drop all messages. */
  reset(): void;
}
```

### Semantics

- **Rollback**: when `send()` is called, the user message is appended to `messages` immediately. The assistant message is committed only when the iterator yields `{ type: "done" }`. If the iterator throws, is aborted, or is broken early before `done`, the user message is popped. Net effect: `messages` is either unchanged or has both new entries — never a half-state.
- **Concurrent send()**: not supported. Calling `send()` while a previous iterator is still active is undefined behavior; consumers shouldn't do it. Not enforced — YAGNI.
- **AbortSignal**: passed through to `fetch` and observed inside the iterator loop. Aborting triggers the rollback path.
- **What gets stored in the assistant message**: only accumulated `text-delta` payloads. Tool events are yielded for the consumer's UI but not persisted in `messages`. Matches today's REPL behavior — the assistant message has only `{ type: "text" }` parts, no tool parts.

## Out of scope

- **Tool-input formatting** (`web_search → "query"` at `repl.ts:12-24`) stays in the REPL. The SDK emits raw `input` payloads; each consumer formats.
- **History-size warnings** (`repl.ts:128-131`) stay in the REPL.
- **Reconnection / retry**: errors propagate; consumer decides.
- **Auth headers**: server has none today; not added speculatively.
- **Non-text message parts**: only `{ type: "text" }` parts are produced. The type allows for extension later but the current implementation only constructs text parts.

## Components

| File | Responsibility |
|------|----------------|
| `client-sdk/package.json` | name `@sounds-and-recreation/agent-client`, `"type": "module"`, `"main"`/`"types"` → `dist/index.js` / `dist/index.d.ts`, `"files": ["dist"]` |
| `client-sdk/tsconfig.json` | `target: ES2022`, `module: ES2022`, `moduleResolution: bundler`, `lib: [DOM, ES2022]`, `declaration: true`, `outDir: dist`, `rootDir: src` — no `@types/node` |
| `client-sdk/src/types.ts` | `UIMessage`, `ChatEvent` discriminated union |
| `client-sdk/src/sse-parser.ts` | Pure function `parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<unknown>` — splits into lines, strips `data: ` prefix, ignores `[DONE]`, JSON-parses each payload |
| `client-sdk/src/client.ts` | `AgentClient` class — owns `messages`, drives `fetch`, consumes parser, accumulates assistant text, yields typed events, handles rollback |
| `client-sdk/src/index.ts` | Barrel re-exports |
| `client-sdk/tests/sse-parser.test.ts` | Pure unit tests on the parser |
| `client-sdk/tests/client.test.ts` | Unit tests for `AgentClient` using mock `fetch` |
| `client-sdk/eslint.config.js` | Mirrors the parent repo's flat-config setup |
| `client-sdk/README.md` | Quick install/use, plus a "Packaging note" section documenting that the macOS packager must copy `dist/` and rewrite the specifier |

Modified in `sound-recreation-agent/`:

- `src/repl.ts` — drops inline `streamChat`; uses `AgentClient`. Keeps history-size warning, ANSI colors, tool-input formatter, and readline.
- `package.json` — adds `"@sounds-and-recreation/agent-client": "file:./client-sdk"`. Adds a top-level script `"build:sdk": "npm --prefix client-sdk run build"` (or chains it into the existing `build`).

## Data flow

```
consumer.send("hello")
  ↓ append user message to client.messages
  ↓ POST {serverUrl}/chat with messages array
  ↓ parseSseStream(response.body)
  ↓ for each parsed event:
      - text-delta: accumulate assistantText, yield event
      - tool-*: yield event (pass-through)
  ↓ stream end: yield { type: "done", assistantText }
  ↓ append assistant message to client.messages
  ↓ iterator returns
```

Error path: any throw inside the iterator (fetch error, parser error, abort) → catch in finally-style block → pop user message → rethrow.

## Tests

### `client-sdk/tests/sse-parser.test.ts`

Fixture-driven. Build a `ReadableStream` from canned `Uint8Array` chunks; assert the iterable yields the right parsed events.

Cases:
1. Single complete event in one chunk → one event yielded.
2. Event split across two chunks (e.g. `data: {"type":"text-delta` then `","delta":"hi"}\n`) → one event.
3. Multiple events in one chunk → all yielded in order.
4. `data: [DONE]` lines → ignored.
5. Lines without `data: ` prefix → ignored.
6. Malformed JSON in a `data:` line → that line skipped, next event still yielded.

### `client-sdk/tests/client.test.ts`

Mock `fetch` returns a `Response` with a `ReadableStream` body. The test feeds canned SSE bytes.

Cases:
1. Successful stream: `messages` after `done` has user msg then assistant msg with the right `assistantText`.
2. `text-delta` events: iterator yields each delta in order; final `done` payload's `assistantText` equals concatenated deltas.
3. Tool events pass through with original `toolName` and `input` / `result`.
4. Stream throws mid-flight: iterator throws, `messages` length unchanged from pre-`send()`.
5. Caller breaks early (consumes one event, then exits the loop): `messages` unchanged.
6. AbortSignal triggered before iteration completes: iterator throws an `AbortError`, `messages` unchanged.
7. Server returns non-2xx: iterator throws, `messages` unchanged.

No integration test against a live server. The existing `tests/integration/agent.test.ts` already covers the wire format end-to-end.

## Risks and mitigations

- **`crypto.randomUUID()` availability** — present in Node 19+ and all modern browsers (Electron renderer included). Acceptable.
- **`ReadableStream.getReader()` on `Response.body`** — present in modern Node fetch and browsers. Acceptable.
- **`for await` over a `ReadableStream`** — Node fetch supports `Response.body` as `ReadableStream` and supports async iteration; the SDK uses an explicit `getReader()` loop instead of `for await` on the body to avoid environment-dependent behavior.
- **Type defs at the consumer** — `client-sdk/package.json` sets `"types": "dist/index.d.ts"`. tsc emits `.d.ts` for every source file. The consumer's `tsc` will resolve them via the `file:` dep.
