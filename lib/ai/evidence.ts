/**
 * Hard evidence rules: live tool receipts (or Derek-provided material) before
 * stating facts about Derek's world, citations, or completed actions.
 */

import {
  isCalendarQuestion,
  isChurchCitationQuestion,
  isEmailQuestion,
  isGitHubQuestion,
  isMorningBriefRequest,
  isOneDriveQuestion,
  isPlannerQuestion,
  isSharePointListQuestion,
  isSharePointQuestion,
} from "@/lib/ai/tool-routing";

/** Tools whose ok=true payload may be cited as live evidence this turn. */
export const EVIDENCE_TOOLS = new Set([
  // Mail / calendar
  "brief_inbox",
  "list_inbox_messages",
  "get_email",
  "get_emails",
  "list_calendar_events",
  "get_calendar_event",
  "gmail_brief_inbox",
  "gmail_list_messages",
  "gmail_get_email",
  "google_list_calendar_events",
  "google_get_calendar_event",
  "list_mail_accounts",
  // Files / Office / SharePoint / Planner
  "list_onedrive_children",
  "search_onedrive",
  "get_onedrive_item",
  "get_onedrive_file_content",
  "read_word_document",
  "read_excel_workbook",
  "read_powerpoint_presentation",
  "create_word_document",
  "create_excel_workbook",
  "create_powerpoint_presentation",
  "write_onedrive_file",
  "create_onedrive_folder",
  "list_sharepoint_folder",
  "list_sharepoint_lists",
  "get_sharepoint_list_items",
  "list_planner_plans",
  "list_planner_tasks",
  "list_my_planner_tasks",
  "get_planner_task",
  "list_todo_lists",
  "list_todo_tasks",
  // GitHub
  "list_github_accounts",
  "list_github_repositories",
  "list_github_projects",
  "github_activity",
  "which_github_account_owns_repo",
  // Memory / stars / tasks (structured, not chat invention)
  "search_memory",
  "list_memories",
  "list_starred_messages",
  "get_starred_message",
  "list_project_tasks",
  "list_teammates",
  "list_projects",
  // Church + morning
  "search_church_site",
  "fetch_church_url",
  "generate_morning_brief",
]);

export function isEvidenceTool(name: string): boolean {
  return EVIDENCE_TOOLS.has(name);
}

export function evidenceToolSucceeded(output: string): boolean {
  try {
    const parsed = JSON.parse(output) as { ok?: boolean };
    return parsed.ok === true;
  } catch {
    return false;
  }
}

/** Honest refusal / uncertainty — do not nudge these. */
export function looksLikeHonestUncertainty(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  return (
    /\b(can'?t|cannot|could not|don'?t|do not|unable to|won'?t)\b[\s\S]{0,50}\b(verify|confirm|find|know|see|access|check|retrieve)\b/i.test(
      text,
    ) ||
    /\b(not (sure|configured|connected|available)|no (live |verified )?(data|results?|evidence|source))\b/i.test(
      text,
    ) ||
    /\b(i (don'?t|do not) have (enough |a )?(verified |live )?(source|evidence|data))\b/i.test(
      text,
    ) ||
    /\bsay so (plainly|clearly)\b/i.test(text)
  );
}

/**
 * Reply that asserts specific live-world facts without sounding like a refusal.
 * Used when no matching evidence tool succeeded this turn.
 */
export function looksLikeUnverifiedLiveClaim(content: string): boolean {
  const text = content.trim();
  if (!text || looksLikeHonestUncertainty(text)) return false;
  return (
    /\b(you have|there(?:'s| is| are)|i (see|found|checked))\b[\s\S]{0,40}\b(meeting|event|appointment|email|message|unread|invite)\b/i.test(
      text,
    ) ||
    /\b(inbox|calendar|agenda)\b[\s\S]{0,40}\b(empty|clear|nothing|no (meetings|events|emails|messages))\b/i.test(
      text,
    ) ||
    /\b(from|sender)\b[\s\S]{0,30}\b(wrote|says|said|asking)\b/i.test(text) ||
    /\b(PR|pull request|#\d+|workflow|commit)\b[\s\S]{0,40}\b(passed|failed|merged|open|ready)\b/i.test(
      text,
    ) ||
    /\b(onedrive|sharepoint|planner)\b[\s\S]{0,40}\b(has|contains|shows|file|task)\b/i.test(
      text,
    ) ||
    // Time alone is not enough — require a calendar/meeting word nearby.
    /\b(meeting|event|appointment|calendar|agenda)\b[\s\S]{0,60}\b\d{1,2}:\d{2}\s*(am|pm)\b/i.test(
      text,
    ) ||
    /\b\d{1,2}:\d{2}\s*(am|pm)\b[\s\S]{0,60}\b(meeting|event|appointment|calendar|agenda)\b/i.test(
      text,
    )
  );
}

/** Domain buckets so memory cannot satisfy a calendar/mail evidence ask. */
export type EvidenceDomain =
  | "mail"
  | "calendar"
  | "github"
  | "onedrive"
  | "planner"
  | "sharepoint"
  | "church"
  | "morning"
  | "memory"
  | "other";

const DOMAIN_TOOLS: Record<EvidenceDomain, ReadonlySet<string>> = {
  mail: new Set([
    "brief_inbox",
    "list_inbox_messages",
    "get_email",
    "get_emails",
    "gmail_brief_inbox",
    "gmail_list_messages",
    "gmail_get_email",
    "list_mail_accounts",
  ]),
  calendar: new Set([
    "list_calendar_events",
    "get_calendar_event",
    "google_list_calendar_events",
    "google_get_calendar_event",
  ]),
  github: new Set([
    "list_github_accounts",
    "list_github_repositories",
    "list_github_projects",
    "github_activity",
    "which_github_account_owns_repo",
  ]),
  onedrive: new Set([
    "list_onedrive_children",
    "search_onedrive",
    "get_onedrive_item",
    "get_onedrive_file_content",
    "read_word_document",
    "read_excel_workbook",
    "read_powerpoint_presentation",
    "create_word_document",
    "create_excel_workbook",
    "create_powerpoint_presentation",
    "write_onedrive_file",
    "create_onedrive_folder",
  ]),
  planner: new Set([
    "list_planner_plans",
    "list_planner_tasks",
    "list_my_planner_tasks",
    "get_planner_task",
    "list_todo_lists",
    "list_todo_tasks",
  ]),
  sharepoint: new Set([
    "list_sharepoint_folder",
    "list_sharepoint_lists",
    "get_sharepoint_list_items",
  ]),
  church: new Set(["search_church_site", "fetch_church_url"]),
  morning: new Set(["generate_morning_brief"]),
  memory: new Set([
    "search_memory",
    "list_memories",
    "list_starred_messages",
    "get_starred_message",
    "list_project_tasks",
  ]),
  other: new Set(),
};

export function evidenceDomainsForQuestion(text: string): EvidenceDomain[] {
  const domains: EvidenceDomain[] = [];
  if (isEmailQuestion(text)) domains.push("mail");
  if (isCalendarQuestion(text)) domains.push("calendar");
  if (isGitHubQuestion(text)) domains.push("github");
  if (isOneDriveQuestion(text)) domains.push("onedrive");
  if (isPlannerQuestion(text)) domains.push("planner");
  if (isSharePointQuestion(text) || isSharePointListQuestion(text)) {
    domains.push("sharepoint");
  }
  if (isChurchCitationQuestion(text)) domains.push("church");
  if (isMorningBriefRequest(text)) domains.push("morning");
  return domains;
}

/** Which required domains (if any) this tool can satisfy. */
export function domainsSatisfiedByTool(
  toolName: string,
  required: EvidenceDomain[],
): EvidenceDomain[] {
  if (!required.length) return [];
  return required.filter((domain) => DOMAIN_TOOLS[domain]?.has(toolName));
}

export function toolSatisfiesDomains(
  toolName: string,
  required: EvidenceDomain[],
): boolean {
  // Empty required ⇒ do not treat memory/generic tools as proof of a live claim.
  if (!required.length) return false;
  return domainsSatisfiedByTool(toolName, required).length > 0;
}

export function allRequiredDomainsMet(
  satisfied: ReadonlySet<EvidenceDomain>,
  required: EvidenceDomain[],
): boolean {
  if (!required.length) return false;
  return required.every((domain) => satisfied.has(domain));
}
