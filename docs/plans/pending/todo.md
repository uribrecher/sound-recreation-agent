# TODO

- Tackle security issues in the agent
- ~~Look for ways to simplify the design/implementation of the agent~~ (done — migrated to ToolLoopAgent)
- ~~After the audio-analysis-mcp is ready, add a flag that passes the path of the new MCP executable as a CLI flag~~ (done — `--audio-mcp` flag + `dev:full` script)
- Add web search tool — `gateway.tools.perplexitySearch()` is a provider-executed tool that doesn't loop with ToolLoopAgent (stops after tool call, never processes result). Replace with a custom tool: either `@perplexity-ai/ai-sdk` or `@tavily/ai-sdk` package, which provide standard `tool()` wrappers with `execute` functions that work in the agent loop.
