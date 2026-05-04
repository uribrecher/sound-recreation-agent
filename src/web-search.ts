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
