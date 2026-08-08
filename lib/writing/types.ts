export const WRITING_MEDIUMS = ["email", "teams", "github_review"] as const;
export type WritingMedium = (typeof WRITING_MEDIUMS)[number];

export const WRITING_AUDIENCES = [
  "executive",
  "customer",
  "church",
  "family",
  "peer",
  "general",
] as const;
export type WritingAudience = (typeof WRITING_AUDIENCES)[number];

export type VoicePack = {
  /** Ready-to-inject system instructions for any writer. */
  instructions: string;
  lessonCount: number;
  styleMemoryCount: number;
};

export type DraftRequest = {
  medium: WritingMedium;
  purpose: string;
  to?: string;
  points?: string[];
  audience?: WritingAudience;
  toneHint?: string;
};

export type DraftResult = {
  medium: WritingMedium;
  audience: WritingAudience;
  subject: string | null;
  body: string;
};
