import { parseStandingInstructionRequest } from "@/lib/standing-instructions/parse";
import type { StandingInstructionRecord } from "@/lib/standing-instructions/types";

export const STANDING_INSTRUCTION_PHRASES = [
  "Standing instruction: never show calendar IDs",
  "From now on: lead with the recommendation",
  "Show standing instructions",
  "Forget standing instruction: Never show calendar IDs",
] as const;

/** How-to card. No model involved. */
export function formatStandingInstructionHelpMessage(): string {
  return [
    "To make a behavior rule stick every turn, say one of these — not “put it in memory”:",
    "",
    ...STANDING_INSTRUCTION_PHRASES,
    "",
    "Those save immediately. Memory is forgotten on unrelated turns.",
  ].join("\n");
}

/** Always-on block for SESSION RUNTIME. Titles only — never instruction ids. */
export function formatStandingInstructionsRuntime(
  items: StandingInstructionRecord[],
): string {
  const lines = [
    "STANDING INSTRUCTIONS (binding — follow every turn, even when a tool payload has extra fields):",
    'These are Derek\'s durable behavior rules. They are not Memory. Chat phrases persist without a tool: "Standing instruction: …", "From now on: …", "Show standing instructions", "Forget standing instruction: …". If he states a rule in other words, call set_standing_instruction — do not only remember().',
  ];
  if (!items.length) {
    lines.push("(none yet)");
    return lines.join("\n");
  }
  for (const item of items) {
    lines.push(`- ${item.title}: ${item.content}`);
  }
  return lines.join("\n");
}

/** User-facing list. No model involved. */
export function formatStandingInstructionsMessage(
  items: Array<{ title: string; content: string }>,
): string {
  if (!items.length) {
    return [
      "No standing instructions yet.",
      'To make a rule stick every turn, say: Standing instruction: never show calendar IDs',
      'Or: From now on: lead with the recommendation',
    ].join("\n");
  }
  const lines = [`Standing instructions (${items.length}):`, ""];
  for (const [index, item] of items.entries()) {
    lines.push(`${index + 1}. ${item.title}`);
    if (item.content.trim() && item.content.trim() !== item.title) {
      lines.push(`   ${item.content.trim()}`);
    }
    lines.push("");
  }
  lines.push(
    'Add another with "Standing instruction: …". Drop one with "Forget standing instruction: [title]".',
  );
  return lines.join("\n").trimEnd();
}

export function formatStandingInstructionSavedMessage(input: {
  title: string;
  content: string;
}): string {
  const extra =
    input.content.trim() && input.content.trim() !== input.title
      ? `\n${input.content.trim()}`
      : "";
  return [
    "Standing instruction saved. This is injected every turn — it is not Memory.",
    "",
    input.title + extra,
    "",
    'Say "show standing instructions" to see the list, or "forget standing instruction: ' +
      input.title +
      '" to drop it.',
  ].join("\n");
}

export function formatStandingInstructionArchivedMessage(title: string): string {
  return `Stopped following: ${title}.`;
}

export function formatStandingInstructionMissingMessage(title: string): string {
  return `No standing instruction named "${title}". Say "show standing instructions" to see the list.`;
}

/** Leftover standing-instruction chat. Keep the current user turn. */
export function isStandingInstructionChatContent(
  role: string,
  content: string,
): boolean {
  const text = content.trim();
  if (role === "user") {
    return parseStandingInstructionRequest(text) !== null;
  }
  if (role === "assistant") {
    return /^(To make a behavior rule stick|Standing instruction saved\.|Standing instructions \(|No standing instructions yet\.|Stopped following:|No standing instruction named )/i.test(
      text,
    );
  }
  return false;
}
