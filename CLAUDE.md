# CLAUDE.md

## Build & Run

```bash
npm run build          # tsc → dist/
npm run start          # HTTP server (port 3001)
npm run dev            # HTTP server via tsx (auto-fetches AI_GATEWAY_API_KEY from 1Password)
npm run dev:full       # HTTP server with both MCP servers (keyboards + audio-analysis)
npm run repl           # REPL client (connects to http://localhost:3001)
```

### CLI Flags (server)

```bash
npm run dev -- --keyboards-mcp ../keyboards-mcp/dist/index.js
npm run dev -- --audio-mcp ../audio-analysis-mcp/.venv/bin/python
npm run dev -- --port 4000
```

### Running server + REPL

```bash
# Terminal 1: start server with MCP servers
npm run dev:full

# Terminal 2: connect REPL client
npm run repl
```

## Linting

```bash
npm run lint           # ESLint (src/ + tests/)
```

## Testing

```bash
npm test               # All tests (unit only)
npm run test:unit      # Unit tests only
npm run test:integration  # Integration tests (hits real AI Gateway, needs 1Password)
```

Tests use `node:test` + `node:assert` (zero test dependencies).

## Architecture

HTTP server using Vercel AI SDK's `ToolLoopAgent` to orchestrate two MCP servers. REPL is a standalone HTTP client.

```
REPL (HTTP client) → POST /chat → HTTP Server → ToolLoopAgent → AI Gateway → LLM
                                       │
                              ┌────────┴────────┐
                              ▼ (stdio)         ▼ (stdio)
                        keyboards-mcp     audio-analysis-mcp
                        (Node)            (Python)
```

Server is stateless — conversation history lives in the client.

### Key modules

- **config.ts** — CLI flags, env vars, defaults (precedence: CLI > env > defaults)
- **agent.ts** — Factory: creates ToolLoopAgent with MCP tools + web search
- **mcp-manager.ts** — Long-lived MCP client lifecycle (connect, cache tools, shutdown)
- **mcp-tool-adapter.ts** — MCP tools → AI SDK tool format (uses `dynamicTool` for runtime-typed MCP tools)
- **system-prompt.ts** — Assembles system prompt from skill + inventory + model context

### Workspace

Part of `~/test/sounds-and-recreation/`:
- `../keyboards-mcp/` — Keyboard MCP server
- `../audio-analysis-mcp/` — Audio analysis MCP server (Python)
- `../macos-packager/` — macOS app packaging