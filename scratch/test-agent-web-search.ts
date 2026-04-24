/**
 * Minimal test: does ToolLoopAgent handle perplexitySearch without hanging?
 * Tests agent.stream() directly (no HTTP server).
 *
 * Run: AI_GATEWAY_API_KEY=<your-key> npx tsx scratch/test-agent-web-search.ts
 */
import { ToolLoopAgent, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";

const agent = new ToolLoopAgent({
  model: gateway("anthropic/claude-sonnet-4-20250514"),
  instructions: "You are a helpful assistant. Use web_search when asked to search.",
  tools: {
    web_search: gateway.tools.perplexitySearch(),
  },
  stopWhen: stepCountIs(5),
  onStepFinish: async ({ stepNumber, finishReason, toolCalls }) => {
    const toolSummary = toolCalls?.map((tc: any) => tc.toolName).join(", ") || "none";
    console.error(`[step ${stepNumber}] finish=${finishReason} tools=[${toolSummary}]`);
  },
});

console.error("Starting stream...");

const result = await agent.stream({
  prompt: "Search the web: what synth was used in Take On Me by a-ha? One sentence answer.",
});

// Use fullStream to see ALL events including tool calls
for await (const chunk of result.fullStream) {
  if (chunk.type === "text-delta") {
    process.stdout.write(chunk.text);
  } else if (chunk.type === "tool-call") {
    console.error(`\n[tool-call] ${chunk.toolName}`);
  } else if (chunk.type === "tool-result") {
    console.error(`[tool-result] ${chunk.toolName}: ${JSON.stringify(chunk.output ?? chunk).slice(0, 200)}`);
  } else {
    console.error(`[${chunk.type}] ${JSON.stringify(chunk).slice(0, 150)}`);
  }
}

console.log("\n\nDone.");