import type { MemoryCategory } from "@/lib/memory/types";

/**
 * Foundational categories require Derek's approval before becoming permanent
 * (per dina-memory-rules.md). Safe factual categories may store automatically.
 */
export const APPROVAL_REQUIRED_CATEGORIES: ReadonlySet<MemoryCategory> = new Set([
  "derek_profile",
  "values",
  "communication_style",
  "preferences",
  "family",
  "church",
  "health",
  "learned_preferences",
]);

/** Sources that already represent Derek-provided or approved knowledge. */
const TRUSTED_SOURCES = new Set([
  "derek_profile",
  "derek_projects",
  "dina_memory_rules",
  "dina_operating_manual",
  "constitution",
  "manual",
  "correction",
  "derek_feedback",
  "derek_approved",
  "imported",
  "test",
]);

export function categoryRequiresApproval(category: string): boolean {
  return APPROVAL_REQUIRED_CATEGORIES.has(category as MemoryCategory);
}

export function resolveMemoryStatus(input: {
  category: string;
  source: string;
  correctId?: string;
}): "active" | "pending_approval" {
  // Explicit correction / update by id = approved path.
  if (input.correctId) return "active";
  if (TRUSTED_SOURCES.has(input.source)) return "active";
  if (categoryRequiresApproval(input.category)) return "pending_approval";
  return "active";
}

/** Map numeric confidence to Dina Memory Rules labels. */
export function confidenceLabel(
  confidence: number,
): "Confirmed" | "High" | "Medium" | "Low" {
  if (confidence >= 0.95) return "Confirmed";
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

export function confidenceFromLabel(
  label: "Confirmed" | "High" | "Medium" | "Low" | string,
): number {
  switch (label) {
    case "Confirmed":
      return 1;
    case "High":
      return 0.85;
    case "Medium":
      return 0.6;
    case "Low":
      return 0.35;
    default:
      return 0.5;
  }
}
