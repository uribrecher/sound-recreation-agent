export interface AgentConfig {
  keyboardsMcpPath: string | undefined;
  audioMcpPath: string | undefined;
  port: number;
  llmModel: string;
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
  port: 2999,
  llmModel: "anthropic/claude-sonnet-4-20250514",
} as const;

export function resolveConfig({ cliFlags, env }: ResolveInput): AgentConfig {
  return {
    keyboardsMcpPath: cliFlags.keyboardsMcpPath ?? env.KEYBOARDS_MCP_PATH ?? undefined,
    audioMcpPath: cliFlags.audioMcpPath ?? env.AUDIO_ANALYSIS_MCP_PATH ?? undefined,
    port: cliFlags.port ?? (env.AGENT_PORT ? parseInt(env.AGENT_PORT, 10) : DEFAULTS.port),
    llmModel: env.LLM_MODEL ?? DEFAULTS.llmModel,
  };
}