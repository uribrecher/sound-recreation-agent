# CLAUDE.md

## Build & Run

```bash
npm run build          # tsc → dist/
npm run start          # HTTP server (port 3001)
npm run dev            # HTTP server via tsx (auto-fetches AI_GATEWAY_API_KEY from 1Password)
```

### CLI Flags

```bash
npm run dev -- --keyboards-mcp ../keyboards-mcp/dist/index.js
npm run dev -- --audio-mcp ../audio-analysis-mcp/.venv/bin/python
npm run dev -- --port 4000
```

## Linting

```bash
npm run lint           # ESLint (src/ + tests/)
```

## Testing

```bash
npm test               # All tests
npm run test:unit      # Unit tests only
```

Tests use `node:test` + `node:assert` (zero test dependencies).

## Architecture

HTTP server that uses Vercel AI SDK to orchestrate two MCP servers:

```
Chat UI (HTTP) → Agent → streamText() → Vercel AI Gateway → LLM
                   │
          ┌────────┴────────┐
          ▼ (stdio)         ▼ (stdio)
    keyboards-mcp     audio-analysis-mcp
    (Node)            (Python)
```

### Key modules

- **config.ts** — CLI flags, env vars, defaults (precedence: CLI > env > defaults)
- **agent.ts** — Core: conversation + streamText() + tool merging
- **mcp-manager.ts** — Long-lived MCP client lifecycle (connect, cache tools, shutdown)
- **mcp-tool-adapter.ts** — MCP tools → AI SDK tool format (uses `dynamicTool` for runtime-typed MCP tools)
- **conversation.ts** — Message history with trim-to-limit
- **system-prompt.ts** — Assembles system prompt from skill + inventory + model context

### Workspace

Part of `~/test/sounds-and-recreation/`:
- `../keyboards-mcp/` — Keyboard MCP server
- `../audio-analysis-mcp/` — Audio analysis MCP server (Python)
- `../macos-packager/` — macOS app packaging
