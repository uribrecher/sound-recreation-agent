# Web Search Tool — Design

**Date:** 2026-05-04
**Status:** Approved (brainstorm)
**Replaces:** TODO at `src/agent.ts:38`

## Problem

`ToolLoopAgent` has no web search. The previously attempted `gateway.tools.perplexitySearch()` is a provider-executed tool (`type: 'provider-defined'`); the SDK does not invoke an in-process `execute` and never feeds a `tool-result` back into the agent loop, so the agent stalls after the call. Scratch files `scratch/inspect-web-search.ts`, `scratch/test-agent-generate.ts`, `scratch/test-agent-web-search.ts` confirmed this.

The recreate-sound skill explicitly relies on web search at steps 4b and 5b ("search for interviews, studio session notes, gear lists"). Without it, the agent cannot complete the research path.

## Solution

Add an in-process `tool({ execute })` wrapper around Tavily's search API via the `@tavily/ai-sdk` package. Register it under the name `web_search` so it stays provider-agnostic from the agent's perspective and matches the existing REPL formatter at `src/repl.ts:15`.

## Components

### `src/web-search.ts` (new)

Single export:

```ts
export function createWebSearchTool(apiKey: string | undefined): ToolSet
```

- When `apiKey` is `undefined`/empty: returns `{}`. Agent runs without web search.
- When `apiKey` is set: returns `{ web_search: tavilySearch({ apiKey, searchDepth: "advanced", maxResults: 5, includeAnswer: true }) }`.

Naming via the object key overrides the package's default `tavilySearch` name; keeps the agent and REPL formatter generic.

### `src/config.ts`

Add field:

```ts
tavilyApiKey: string | undefined; // env: TAVILY_API_KEY
```

Sourced from `env.TAVILY_API_KEY` only — no CLI flag (matches `AI_GATEWAY_API_KEY`, which is also env-only and read by the SDK directly).

### `src/agent.ts`

- Import `createWebSearchTool`.
- Replace the TODO comment with `...createWebSearchTool(config.tavilyApiKey)` spread into the `tools` object.
- Extend the startup log to mention web-search status (`enabled` / `disabled`) alongside the MCP servers line.

### `package.json`

- Add dependency: `@tavily/ai-sdk` (latest, AI SDK v6 compatible).
- Update scripts to fetch the Tavily key from 1Password alongside the gateway key:
  - `dev`: prepend `TAVILY_API_KEY=$(op read 'op://<vault>/<tavily-item>/credential' --account my.1password.com)`
  - `dev:full`: same prepend.

The integration scripts (`test:integration`) already gate on the gateway key; we don't add Tavily there since unit tests cover the registration logic without live API calls.

### Tests — `tests/unit/web-search.test.ts` (new)

Two cases, no network:

1. `createWebSearchTool(undefined)` returns `{}` (no `web_search` key).
2. `createWebSearchTool("fake-key")` returns an object whose only key is `web_search`. We assert key presence and that the value is a non-null object — that's enough to confirm registration without coupling to `@tavily/ai-sdk`'s runtime shape, and avoids any live API call.

`tests/unit/agent.test.ts` and `tests/unit/config.test.ts` are extended:

- `agent.test.ts`: existing config has `tavilyApiKey: undefined` added to `baseConfig`.
- `config.test.ts`: one new test — `TAVILY_API_KEY` env var flows into `config.tavilyApiKey`.

### Scratch cleanup

Delete:
- `scratch/inspect-web-search.ts`
- `scratch/test-agent-generate.ts`
- `scratch/test-agent-web-search.ts`

(Their job ended once the design was settled.)

### TODO list cleanup

Strike-through the web-search bullet in `docs/plans/pending/todo.md` (matching the existing strike-through style for completed items).

## Data flow

```
LLM → tool-call(web_search, {query}) → AI SDK runs tavilySearch.execute()
    → Tavily HTTPS API → results JSON → tool-result chunk
    → ToolLoopAgent next step → LLM continues
```

No streaming gotchas; results are a normal in-process tool result.

## Trade-offs and rejected options

- **Perplexity (direct API)** — higher-quality narrative answers but pricier and overlaps with what the LLM will do anyway. Rejected: cost and redundancy.
- **DuckDuckGo HTML scrape** — zero-key, but lower quality, breakage risk, no AI-tuned snippets. Rejected: too fragile for a research-critical step.
- **Hard-required API key (crash if absent)** — simpler, but breaks the existing "graceful conditional tool" pattern used for `keyboardsMcpPath` and `audioMcpPath` at `agent.ts:17-30`. Rejected for consistency.
- **Keep package default `tavilySearch` name** — would require updating the REPL formatter and would lock the public-facing tool name to one provider. Rejected: generic name preserves the swap option.

## Out of scope

- Tavily's other tools (`tavilyExtract`, `tavilyCrawl`, `tavilyMap`). May be added later if a research step needs page-fetch.
- Caching of search results.
- Per-call config overrides (the LLM passes `query`; static config covers depth/results/answer).
- System-prompt updates — the existing skill already describes the research step in provider-neutral terms.
