export interface AgentConfig {
  keyboardsMcpPath: string | undefined;
  audioMcpPath: string | undefined;
  port: number;
  llmModel: string;
  maxHistoryMessages: number;
  gatewayApiKey: string | undefined;
}

interface CliFlags {
  keyboardsMcpPath?: string;
  audioMcpPath?: string;
  port?: number;
}

interface ResolveInput {
  cliFlags: CliFlags;
  env: Record<string, string | undefined>;
}

const DEFAULTS = {
  port: 3001,
  llmModel: "anthropic/claude-sonnet-4-20250514",
  maxHistoryMessages: 40,
} as const;

export function resolveConfig({ cliFlags, env }: ResolveInput): AgentConfig {
  return {
    keyboardsMcpPath: cliFlags.keyboardsMcpPath ?? env.KEYBOARDS_MCP_PATH ?? undefined,
    audioMcpPath: cliFlags.audioMcpPath ?? env.AUDIO_ANALYSIS_MCP_PATH ?? undefined,
    port: cliFlags.port ?? (env.AGENT_PORT ? parseInt(env.AGENT_PORT, 10) : DEFAULTS.port),
    llmModel: env.LLM_MODEL ?? DEFAULTS.llmModel,
    maxHistoryMessages: env.MAX_HISTORY_MESSAGES
      ? parseInt(env.MAX_HISTORY_MESSAGES, 10)
      : DEFAULTS.maxHistoryMessages,
    gatewayApiKey: env.AI_GATEWAY_API_KEY,
  };
}
