import type { LearningSignal, LessonCandidate } from "@/lib/learning/types";

const ONE_OPTION =
  /\b(one|a single|just one)\b.{0,24}\b(option|recommendation|choice|path)\b|\bprefer one\b|\bdon'?t give me (five|\d+)\b|\bnot (five|\d+) options?\b|\bone recommended option\b/i;

const SHORTER =
  /\b(shorter|more concise|less verbose|too long|keep it brief|be brief)\b/i;

const NO_OPTIONS_LIST =
  /\b(no|don'?t|stop)\b.{0,20}\b(list of )?(options|alternatives|choices)\b/i;

/**
 * Deterministic lesson extraction for clear Derek feedback.
 * Returns null when the signal is too weak — caller may try model distill.
 */
export function heuristicLessonFromSignal(
  signal: LearningSignal,
): LessonCandidate | null {
  const note = (signal.note || "").trim();
  const blob = [note, signal.draftBody || "", signal.priorRecommendedAction || ""]
    .join("\n")
    .trim();

  if (
    (signal.action === "revise_draft" || signal.action === "edited_draft") &&
    (ONE_OPTION.test(note) || ONE_OPTION.test(blob) || NO_OPTIONS_LIST.test(note))
  ) {
    return {
      category: "learned_preferences",
      title: "Recommendation format",
      content:
        "Prefer one recommended option instead of a list of multiple alternatives, unless Derek explicitly asks for options.",
      confidence: note ? 0.95 : 0.8,
      source: note ? "derek_feedback" : "learning_engine",
    };
  }

  if (
    (signal.action === "revise_draft" || signal.action === "edited_draft") &&
    SHORTER.test(note)
  ) {
    return {
      category: "learned_preferences",
      title: "Response length",
      content:
        "Keep recommendations and drafts concise. Prefer shorter wording unless the decision needs depth.",
      confidence: 0.9,
      source: "derek_feedback",
    };
  }

  // Explicit revise note that looks like a durable preference statement.
  if (signal.action === "revise_draft" && note.length >= 12) {
    if (
      /^(always|never|prefer|please|do not|don't|from now on|remember)\b/i.test(
        note,
      )
    ) {
      return {
        category: "learned_preferences",
        title: summarizeTitle(note),
        content: note.replace(/\s+/g, " ").trim(),
        confidence: 0.85,
        source: "derek_feedback",
      };
    }
  }

  if (signal.action === "dismissed_unimportant") {
    const subject = (signal.subject || signal.itemSummary || "").trim();
    if (!subject || subject.length < 8) return null;
    // Only learn a soft pattern when category was already low-signal types —
    // avoid teaching "ignore everything like funding emails".
    if (signal.itemCategory === "fyi_ignore") return null;
    return null;
  }

  return null;
}

function summarizeTitle(note: string): string {
  const cleaned = note.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 48) return cleaned.replace(/[.?!:]+$/, "");
  return `${cleaned.slice(0, 45).trim()}…`;
}
