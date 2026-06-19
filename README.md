# sound-recreation-agent

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![CI](https://github.com/uribrecher/sound-recreation-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/uribrecher/sound-recreation-agent/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/uribrecher/sound-recreation-agent?style=flat&logo=github)](https://github.com/uribrecher/sound-recreation-agent/stargazers)

AI agent that reverse-engineers keyboard sounds from songs and applies them to hardware synthesizers via MIDI. Powered by Vercel AI SDK's `ToolLoopAgent` and the Model Context Protocol (MCP).

## How it works

1. You name a song
2. The agent fetches the audio, separates stems, and isolates keyboard parts
3. It analyzes the spectral characteristics to identify the sound engine (subtractive, FM, organ, sample-based, etc.)
4. It predicts synth parameters via ML-based inverse synthesis or manual spectral analysis
5. It applies the settings to your connected MIDI keyboard

## Architecture

```
REPL (HTTP client) --> POST /chat --> HTTP Server --> ToolLoopAgent --> AI Gateway --> LLM
                                          |
                                 +--------+--------+
                                 v (stdio)         v (stdio)
                           keyboards-mcp     audio-analysis-mcp
                           (Node)            (Python)
```

- **Server** is stateless -- conversation history lives in the client
- **ToolLoopAgent** handles the agentic loop (tool calls, results, multi-step reasoning)
- **MCP servers** provide keyboard control and audio analysis tools over stdio

## Prerequisites

- Node.js 20+
- [Vercel AI Gateway](https://sdk.vercel.ai/docs/ai-sdk-core/settings#api-key) API key (`AI_GATEWAY_API_KEY`)
- (Optional) `keyboards-mcp` built at `../keyboards-mcp/dist/index.js`
- (Optional) `audio-analysis-mcp` Python venv at `../audio-analysis-mcp/.venv/bin/python`

## Quick start

```bash
# Install dependencies
npm install

# Provide secrets first: copy .env.example and fill in, export the vars
# yourself, or use the 1Password helper:
#   cp scripts/dev.local.sh.example scripts/dev.local.sh   # then edit op:// refs

# Start the server (reads AI_GATEWAY_API_KEY / TAVILY_API_KEY from the environment)
npm run dev

# Or start with both MCP servers
npm run dev:full

# In a separate terminal, connect the REPL
npm run repl
```

## Available scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Start compiled server |
| `npm run dev` | Start server via tsx (reads API keys from env) |
| `npm run dev:full` | Start with keyboards-mcp + audio-analysis-mcp |
| `npm run repl` | Connect REPL client to running server |
| `npm run lint` | ESLint |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests (needs API key) |

## CLI flags (server)

```bash
npm run dev -- --keyboards-mcp ../keyboards-mcp/dist/index.js
npm run dev -- --audio-mcp ../audio-analysis-mcp/.venv/bin/python
npm run dev -- --port 4000
```

## MCP tools

### keyboards-mcp

Control MIDI keyboards (Nord Electro 5D, Roland JUNO-X, Prophet-6):
`connect_to_keyboard`, `list_midi_devices`, `list_programs`, `load_program`, `set_parameters`, `list_parameters`, `get_current_state`, and more.

### audio-analysis-mcp

Audio analysis for sound recreation:
`import_audio`, `stem_separate`, `spectrum_analyze`, `audio_compare`, `audio_render`, `audio_list_devices`.

## Testing

```bash
npm test                   # Unit tests (12 tests, ~0.3s)
npm run test:integration   # Integration tests (7 tests, ~40s, needs API key)
```

Tests use `node:test` + `node:assert` (zero test dependencies). Integration tests spin up a real HTTP server and test SSE streaming, UIMessage format validation, multi-turn conversation, and MCP tool calls.

## Related projects

Part of the [sounds-and-recreation](https://github.com/uribrecher) workspace:

- [`keyboards-mcp`](../keyboards-mcp/) -- MCP server controlling MIDI keyboards
- [`audio-analysis-mcp`](../audio-analysis-mcp/) -- Audio analysis MCP server (Python)
- [`macos-packager`](../macos-packager/) -- macOS .app/.dmg packaging

## License

Licensed under the GNU General Public License v3.0 (GPL-3.0-or-later). See [LICENSE](LICENSE).