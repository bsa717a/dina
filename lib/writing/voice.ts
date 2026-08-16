import { getDinaOperatingManual } from "@/lib/ai/dina-operating-manual";
import {
  formatLessonsForPrompt,
  listActiveLessons,
} from "@/lib/learning/lessons";
import { listMemories } from "@/lib/memory/store";
import type { VoicePack } from "@/lib/writing/types";

const WRITING_STYLE_FALLBACK = `Every piece of writing should sound like Derek.
Characteristics: concise, confident, warm, direct, practical, conversational, respectful.
Avoid: corporate language, unnecessary apologies, generic AI phrases, excessive excitement, repeating the same point.
Always recommend one option rather than presenting many equivalent choices.
Adapt tone for: executives, customers, church leaders, family, friends.`;

/** Extract the Writing Style section from the operating manual. */
export function extractWritingStyleSection(manual?: string): string {
  const text = manual ?? getDinaOperatingManual();
  const match = text.match(
    /# Writing Style\s*([\s\S]*?)(?=\n# |\n---\s*\n# |$)/i,
  );
  const section = match?.[1]?.trim();
  return section && section.length > 40 ? section : WRITING_STYLE_FALLBACK;
}

/**
 * Shared voice pack for chat drafts, Attention generate-draft, and Attention revise.
 */
export async function buildVoicePack(options?: {
  recipientHint?: string;
}): Promise<VoicePack> {
  const styleSection = extractWritingStyleSection();
  const [lessons, styleMemories] = await Promise.all([
    listActiveLessons(16),
    listMemories({ category: "communication_style", status: "active", limit: 12 }),
  ]);

  const styleLines = styleMemories.map((m) => `- ${m.title}: ${m.content}`);
  const lessonsBlock = formatLessonsForPrompt(lessons);

  const parts = [
    "Write in Derek Fowler's voice.",
    "",
    "## Writing Style",
    styleSection,
  ];

  if (styleLines.length) {
    parts.push("", "## Communication style memories", ...styleLines);
  }
  if (lessonsBlock) {
    parts.push("", lessonsBlock);
  }
  if (options?.recipientHint?.trim()) {
    parts.push("", "## Recipient context", options.recipientHint.trim());
  }

  parts.push(
    "",
    "## Hard rules",
    "- Sound like Derek, not a generic AI.",
    "- Prefer one clear recommendation or ask.",
    "- Do not send, post, or claim delivery — draft only unless a separate send tool is used after approval.",
  );

  return {
    instructions: parts.join("\n"),
    lessonCount: lessons.length,
    styleMemoryCount: styleMemories.length,
  };
}

/** Compact voice block for appending to existing system prompts. */
export async function getVoiceInstructionsForPrompt(options?: {
  recipientHint?: string;
}): Promise<string> {
  const pack = await buildVoicePack(options);
  return pack.instructions;
}
