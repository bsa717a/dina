/**
 * Chief of Staff Engine — central decision layer.
 * Integrations never talk to this engine via vendor APIs; they emit NormalizedEvents.
 */

export const NORMALIZED_EVENT_TYPES = [
  "NewEmail",
  "EmailThreadUpdated",
  "CalendarChanged",
  "MeetingInvitation",
  "PullRequestOpened",
  "PullRequestReadyForReview",
  "WorkflowFailed",
  "WorkflowSucceeded",
  "IssueAssigned",
  "AgentCompletedTask",
  "RepositoryInactive",
  "ReminderDue",
  "FileShared",
  /** Connector/integration health (e.g. one GitHub account auth failed). */
  "IntegrationAlert",
] as const;

export type NormalizedEventType = (typeof NORMALIZED_EVENT_TYPES)[number];

export const DISPOSITIONS = [
  "create_attention_card",
  "add_to_todays_briefing",
  "update_project_context",
  "store_as_context",
  "ignore",
] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Stable connector id — not used for decision logic, only audit/provenance. */
export type ConnectorId = "microsoft365" | "github" | string;

export type NormalizedEvent = {
  /** Globally unique id for this event occurrence (connector-scoped). */
  eventId: string;
  type: NormalizedEventType;
  /** When the underlying thing happened / was observed (ISO). */
  occurredAt: string;
  /** Short human title (subject / PR title / meeting name). */
  title: string;
  /** Neutral body the engine can reason over — no vendor API details required. */
  summary: string;
  /** Optional actor (sender, author, organizer). */
  actor?: string;
  /** Optional project hint from the connector (repo key, plan name, etc.). */
  projectHint?: string;
  /** Provenance only — engine must not branch on this for business rules. */
  connector: ConnectorId;
  /** Opaque connector payload for audit / later learning. */
  payload?: Record<string, unknown>;
};

export type CosAnalysis = {
  needsToKnow: boolean;
  urgency: Priority;
  canWait: boolean;
  relatedToProject: boolean;
  projectKey?: string | null;
  someoneWaitingOnDerek: boolean;
  derekWaitingOnSomeone: boolean;
  canRecommendAction: boolean;
  canDraft: boolean;
  isContextOnly: boolean;
};

export type CosDecision = {
  eventId: string;
  eventType: NormalizedEventType;
  connector: ConnectorId;
  disposition: Disposition;
  priority: Priority;
  /** 0–1 */
  confidence: number;
  reasoningSummary: string;
  /** Why interrupt — required when disposition is create_attention_card */
  interruptWhy?: string | null;
  recommendedAction?: string | null;
  analysis: CosAnalysis;
  draftSubject?: string | null;
  draftBody?: string | null;
  notifyNow: boolean;
  /**
   * Durable structured memory write (not chat transcript).
   * Independent of disposition — only when knowledge should persist.
   */
  memoryWrite?: {
    category:
      | "derek_profile"
      | "values"
      | "communication_style"
      | "preferences"
      | "family"
      | "church"
      | "health"
      | "people"
      | "projects"
      | "commitments"
      | "decisions"
      | "learned_preferences";
    title: string;
    content: string;
    confidence: number;
    importance: Priority;
  } | null;
  /** Card fields when creating attention */
  card?: {
    sender?: string;
    subject?: string;
    summary: string;
    whyItMatters: string;
    category:
      | "reply_required"
      | "decision_required"
      | "calendar_action"
      | "waiting_on_someone"
      | "fyi_ignore";
    occursAt?: string | null;
    occursEndAt?: string | null;
    githubAccountId?: string | null;
    githubAccountLabel?: string | null;
    githubRepoKey?: string | null;
  };
};

export function dispositionLabel(disposition: string): string {
  switch (disposition) {
    case "create_attention_card":
      return "Create Attention Card";
    case "add_to_todays_briefing":
      return "Add to Today’s Briefing";
    case "update_project_context":
      return "Update Project Context";
    case "store_as_context":
      return "Store as Context";
    case "ignore":
      return "Ignore";
    default:
      return disposition;
  }
}
