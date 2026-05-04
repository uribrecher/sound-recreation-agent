import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let recreateSoundSkill: string | null = null;

function loadRecreateSoundSkill(): string {
  if (recreateSoundSkill) return recreateSoundSkill;
  const skillPath = join(__dirname, "..", "prompts", "recreate-sound.md");
  recreateSoundSkill = readFileSync(skillPath, "utf-8");
  return recreateSoundSkill;
}

interface SystemPromptContext {
  inventory: string | null;
  modelPrompt: string | null;
}

export function buildSystemPrompt(context: SystemPromptContext): string {
  const sections: string[] = [];

  sections.push("You are a sound recreation agent that helps users recreate keyboard sounds from songs.");
  sections.push("You have access to keyboard control tools and audio analysis tools via MCP.");

  sections.push(
    [
      "## Per-Device Preflight (mandatory before set_parameters)",
      "",
      "Each connected keyboard ships its own usage notes — engine layout, parameter preconditions, model-specific quirks — that are NOT in this system prompt. You must load them before changing parameters on a device.",
      "",
      "Rule: before the FIRST `set_parameters` call against any device in this session, call `get_system_prompt(device=N)` for that device. The returned guidance overrides any generic assumptions you would make from tool descriptions alone. One fetch per device per session is enough.",
      "",
      "This applies even when only one device is connected. The single-device skip in the recreate-sound workflow only skips device-selection scoring — it does NOT skip this preflight.",
    ].join("\n"),
  );

  const skill = loadRecreateSoundSkill();
  sections.push("## Sound Recreation Workflow\n\n" + skill);

  sections.push(
    [
      "## Communication Style",
      "",
      "- Be concise. Default to short answers; expand only when the user asks \"explain\", \"why\", or asks a follow-up.",
      "- Run tools without preamble. Do not announce \"I'll search for…\", \"Let me analyze…\" — just call the tool.",
      "- After a tool completes, give a one- or two-sentence summary of what you found. Do not repeat the tool's raw output.",
      "- When summarizing search results, lead with the most relevant fact. Skip provenance and process unless asked.",
      "- Do not list the steps you took. Do not narrate decisions. The transcript already shows the tool calls.",
      "- If you don't know something, say so in one sentence. No hedging paragraphs.",
    ].join("\n"),
  );

  if (context.inventory) {
    sections.push("## Available Keyboard Inventory\n\n" + context.inventory);
  }

  if (context.modelPrompt) {
    sections.push("## Connected Keyboard Details\n\n" + context.modelPrompt);
  }

  return sections.join("\n\n");
}
