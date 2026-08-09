export const ATTENTION_CATEGORIES = [
  "reply_required",
  "decision_required",
  "calendar_action",
  "waiting_on_someone",
  "fyi_ignore",
] as const;

export type AttentionCategory = (typeof ATTENTION_CATEGORIES)[number];

export const ATTENTION_STATUSES = [
  "open",
  "dismissed",
  "resolved",
  "sent",
  "snoozed",
] as const;

export type AttentionStatus = (typeof ATTENTION_STATUSES)[number];

export const ATTENTION_ACTION_TYPES = [
  "accepted_recommendation",
  "edited_draft",
  "revise_draft",
  "sent_draft",
  "ignored_notification",
  "dismissed_unimportant",
  "blocked_sender",
  "reviewed",
] as const;

export type AttentionActionType = (typeof ATTENTION_ACTION_TYPES)[number];

export type AttentionSource =
  | "email"
  | "calendar"
  | "todo"
  | "meeting_invite"
  | "github";

export type CollectedSignal = {
  source: AttentionSource;
  sourceId: string;
  sender?: string;
  subject?: string;
  preview: string;
  receivedAt?: string;
  raw: Record<string, unknown>;
};

export type ClassifiedAttention = {
  source: AttentionSource;
  sourceId: string;
  category: AttentionCategory;
  sender?: string;
  senderEmail?: string;
  /** Provenance connector id, e.g. microsoft365 | google | github */
  connector?: string;
  accountLabel?: string;
  accountEmail?: string;
  subject?: string;
  summary: string;
  whyItMatters: string;
  recommendedAction: string;
  askSummary?: string;
  needsResponse: boolean;
  hasDeadline: boolean;
  deadlineAt?: string | null;
  /** Event start (calendar) or due date when known. */
  occursAt?: string | null;
  occursEndAt?: string | null;
  /** Present for GitHub-sourced items — never omit when source is github. */
  githubAccountId?: string | null;
  githubAccountLabel?: string | null;
  githubRepoKey?: string | null;
  isBlocking: boolean;
  canWait: boolean;
  shouldDraftReply: boolean;
  draftSubject?: string | null;
  draftBody?: string | null;
  notifyNow: boolean;
  notificationTitle?: string | null;
  notificationBody?: string | null;
};

export function categoryLabel(category: string): string {
  switch (category) {
    case "reply_required":
      return "Reply Required";
    case "decision_required":
      return "Decision Required";
    case "calendar_action":
      return "Calendar Action";
    case "waiting_on_someone":
      return "Waiting On Someone Else";
    case "fyi_ignore":
      return "FYI / Ignore";
    default:
      return category;
  }
}

export function isActionableCategory(category: string): boolean {
  return category !== "fyi_ignore";
}
