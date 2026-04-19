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

  const skill = loadRecreateSoundSkill();
  sections.push("## Sound Recreation Workflow\n\n" + skill);

  if (context.inventory) {
    sections.push("## Available Keyboard Inventory\n\n" + context.inventory);
  }

  if (context.modelPrompt) {
    sections.push("## Connected Keyboard Details\n\n" + context.modelPrompt);
  }

  return sections.join("\n\n");
}
