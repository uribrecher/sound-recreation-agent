export interface WebSearchSource {
  url: string;
  title: string;
  content: string;
  score?: number;
}

export interface WebSearchResult {
  query: string;
  answer?: string;
  results: WebSearchSource[];
}

export function isWebSearchResult(
  toolName: string,
  result: unknown,
): result is WebSearchResult {
  if (toolName !== "web_search") return false;
  if (typeof result !== "object" || result === null) return false;
  const r = result as Record<string, unknown>;
  return typeof r.query === "string" && Array.isArray(r.results);
}
