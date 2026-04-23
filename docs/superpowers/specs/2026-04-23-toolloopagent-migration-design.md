# Migrate sound-recreation-agent to ToolLoopAgent + Add Audio-Analysis-MCP

## Context

The sound-recreation-agent currently uses `streamText()` from the Vercel AI SDK with manual message reconstruction and duplicated stream-consumption logic across the HTTP server and REPL. The Vercel AI SDK v6 introduced `ToolLoopAgent`, an opinionated wrapper that eliminates manual tool-loop management, message reconstruction, and SSE boilerplate. Additionally, the audio-analysis-mcp server is now functional and should be integrated.

## Goals

1. Replace `streamText()` with `ToolLoopAgent` to simplify the agent core
2. Replace manual SSE streaming with `createAgentUIStreamResponse()`
3. Redesign the REPL as a thin HTTP client (no in-process agent dependency)
4. Move conversation state from server to client
5. Connect audio-analysis-mcp alongside keyboards-mcp

## Architecture

```
                              ┌─────────────────────────────────────┐
  REPL (HTTP client)          │  HTTP Server (index.ts)             │
  ─────────────────           │                                     │
  readline → POST /chat ────► │  createAgentUIStreamResponse()      │
  parse SSE ◄──────────────── │         │                           │
  format tool calls           │    ToolLoopAgent                    │
  maintain local history      │    ├── model (gateway)              │
                              │    ├── instructions (system prompt) │
                              │    ├── tools (merged MCP + search)  │
                              │    └── stopWhen(10)                 │
                              │         │                           │
                              │    ┌────┴────┐                      │
                              │    ▼         ▼                      │
                              │ keyboards  audio-analysis           │
                              │   -mcp       -mcp                   │
                              └─────────────────────────────────────┘
```

## Design

### 1. Agent Core (src/agent.ts)

Replace the `Agent` class with a ToolLoopAgent factory function.

**Before:** `Agent` class with `chat()` returning `streamText()` result, plus `addResponseFromEvents()` for manual message reconstruction (~60 lines).

**After:** Factory function returning a configured `ToolLoopAgent` instance:

```typescript
import { ToolLoopAgent } from 'ai';

export function createAgent(config: AgentConfig, mcpManager: McpManager): ToolLoopAgent {
  return new ToolLoopAgent({
    model: gateway(config.llmModel),
    instructions: buildSystemPrompt({ inventory: null, modelPrompt: null }),
    tools: {
      ...mcpManager.getMergedTools(),
      // TODO: web search — provider-executed tools don't loop with ToolLoopAgent
    },
    stopWhen: stepCountIs(10),
  });
}
```

**Deleted:** `ConversationHistory` class, `addResponseFromEvents()`, `StreamEvent` interface, all manual message reconstruction logic.

### 2. HTTP Server (src/index.ts)

Replace manual SSE streaming with `createAgentUIStreamResponse()`.

**Before:** Manual `for await (const part of result.fullStream)` loop writing `data: {text}\n\n` events, collecting events for message reconstruction, sending `[DONE]` sentinel.

**After:**
```typescript
// POST /chat
const { messages } = await request.json();  // UIMessage[] from client
return createAgentUIStreamResponse({ agent, uiMessages: messages });
```

**Key changes:**
- Request body changes from `{message: string}` to `{messages: UIMessage[]}`
- Server becomes stateless — no conversation history stored
- `/reset` endpoint can be removed (client clears its own history)
- CORS handling stays

### 3. REPL as HTTP Client (src/repl.ts)

Rewrite from in-process agent consumer to standalone HTTP client.

**Responsibilities:**
- Maintain conversation history (array of `UIMessage`) locally
- On user input: append user message to history, POST full history to `/chat`
- Parse SSE events from response, render with formatting:
  - Text deltas: print inline
  - Tool calls: cyan `[tool: name]` with compact params
  - Tool results: green `done`
- After stream completes: append assistant response (with tool calls/results) to local history
- Commands: `/reset` (clear local history), `/quit` (exit)

**Startup:** Only needs server URL (default `http://localhost:3001`). No MCP paths or API keys.

**Running:**
```bash
# Terminal 1: start the server
npm run dev -- --keyboards-mcp ../keyboards-mcp/dist/index.js --audio-mcp ../audio-analysis-mcp/.venv/bin/python

# Terminal 2: connect the REPL
npm run repl
```

### 4. Audio-Analysis-MCP Integration

The audio-analysis-mcp server is already partially wired in config.ts (`audioMcpPath` field, `AUDIO_ANALYSIS_MCP_PATH` env var). The MCP manager already handles multiple servers generically.

**Connection config in agent startup:**
```typescript
{
  id: "audio-analysis-mcp",
  command: config.audioMcpPath,      // .venv/bin/python
  args: ["-m", "audio_analysis_mcp"],
}
```

**Changes needed:**
- Verify connection config works with the real audio-analysis-mcp server
- Update `npm run dev` script to include `--audio-mcp` flag pointing to the Python venv
- Add a combined script (e.g., `npm run dev:full`) that starts with both MCP servers

**Available audio tools (6):** `import_audio`, `stem_separate`, `spectrum_analyze`, `audio_compare`, `audio_render`, `audio_list_devices`

### 5. Conversation State: Client-Side

Conversation history moves from server (`ConversationHistory` class) to client (REPL or future web UI).

**Rationale:**
- Server becomes stateless — no leaked state between clients
- Each client manages its own session
- Aligns with Vercel AI SDK's `useChat` protocol where the client sends full message history
- Future web UI clients get the same treatment for free

### 6. Modules Kept Unchanged

- **src/mcp-manager.ts** — MCP server lifecycle management. No changes needed.
- **src/mcp-tool-adapter.ts** — MCP-to-AI-SDK tool conversion. No changes needed.
- **src/system-prompt.ts** — System prompt assembly. No changes needed.
- **src/config.ts** — Minor update: REPL may only need a `serverUrl` config option instead of MCP paths.

## File Change Summary

| File | Action | Notes |
|------|--------|-------|
| `src/agent.ts` | Rewrite | Class → ToolLoopAgent factory function |
| `src/index.ts` | Rewrite | Manual SSE → `createAgentUIStreamResponse` |
| `src/repl.ts` | Rewrite | In-process consumer → HTTP client with SSE parsing |
| `src/conversation.ts` | Delete | Client-side responsibility |
| `src/config.ts` | Minor update | Add server URL for REPL mode |
| `src/mcp-manager.ts` | Keep | No changes |
| `src/mcp-tool-adapter.ts` | Keep | No changes |
| `src/system-prompt.ts` | Keep | No changes |
| `package.json` | Update | Scripts for combined dev, REPL client |
| `tests/unit/conversation.test.ts` | Delete | No more ConversationHistory |
| `tests/unit/agent.test.ts` | Rewrite | Test ToolLoopAgent setup |
| `tests/integration/agent.test.ts` | Rewrite | Test via HTTP |
| `CLAUDE.md` | Update | New architecture, run commands |

## Verification

1. `npm run build` — compiles without errors
2. `npm run lint` — passes
3. `npm test` — all updated tests pass
4. Start server with both MCP servers, connect REPL, verify:
   - Text streaming works
   - Tool calls render with cyan formatting
   - Tool results render with green formatting
   - Audio-analysis-mcp tools are discoverable (e.g., ask "list audio devices")
   - Keyboards-mcp tools still work
   - `/reset` clears REPL history
   - Multiple back-to-back messages maintain conversation context