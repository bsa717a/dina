/**
 * Local Slack replies for the Regi-only Piper bot.
 *
 * Slack inbound must answer here — never via Grok Bot / Old Dina webhook.
 * Telnyx RCS still uses lib/telnyx/handoff.ts.
 */

import { logger } from "@/lib/logger";
import { displayProjectName } from "@/lib/project-tasks/keys";
import {
  formatRemainingTaskLines,
  formatRemainingTasksMessage,
} from "@/lib/project-tasks/format";
import { listProjectTasks } from "@/lib/project-tasks/store";
import type { NumberedProjectTask } from "@/lib/project-tasks/types";
import type { SlackLedgerResult } from "./ledger";
import { resolveRegiProjectKey } from "./scope";
import type { SlackRosterLookupResult } from "./types";

export type SlackLocalReplyKind =
  | "remaining_tasks"
  | "assignee_status"
  | "ack";

export interface SlackLocalReply {
  kind: SlackLocalReplyKind;
  text: string;
}

const POLITE_PREFIX =
  /^(?:(?:please|hey|hi|ok|okay|piper) |(?:can|could|would|will) you )+/;
const TRAILING_POLITE = /\s+(?:for(?: the)? regi|please|thanks|thank you)$/;

function normalizeIntentText(text: string): string {
  return text
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripQueryFiller(normalized: string): string {
  let next = normalized;
  let prev = "";
  while (next !== prev) {
    prev = next;
    next = next.replace(POLITE_PREFIX, "").replace(TRAILING_POLITE, "").trim();
  }
  return next;
}

function isAssigneeStatusAsk(normalized: string): boolean {
  return (
    /\b(my remaining tasks?|my (?:open |all )?tasks?|assigned to me|on my plate|my backlog|my status)\b/.test(
      normalized,
    ) ||
    /^(status|what(?:'s| is) (?:my )?status)$/.test(normalized) ||
    /^(?:what tasks? do i have|do i have (?:any )?tasks?)$/.test(normalized)
  );
}

function isRemainingTasksAsk(normalized: string): boolean {
  return (
    /^(?:show|list|recite|get|display|give)(?: me| us)?(?: (?:the|all|our))*(?: remaining| open)?(?: project)? tasks?$/.test(
      normalized,
    ) ||
    /^(?:what(?:'s|s| are| is)|whats)(?: (?:the|all))*(?: remaining(?: tasks?)?| open(?: tasks?)?| tasks?| left)$/.test(
      normalized,
    ) ||
    /^(?:(?:all|the) )?(?:remaining|open) tasks?$/.test(normalized) ||
    /^(?:all|the) tasks?$/.test(normalized) ||
    /^(?:task list|what'?s left)$/.test(normalized)
  );
}

/** List/status asks — work requests stay on the ack path. */
export function classifySlackLocalIntent(text: string): SlackLocalReplyKind {
  const normalized = stripQueryFiller(normalizeIntentText(text));
  if (!normalized) return "ack";
  if (isAssigneeStatusAsk(normalized)) return "assignee_status";
  if (isRemainingTasksAsk(normalized)) return "remaining_tasks";
  return "ack";
}

export function formatSlackLedgerAck(ledger: SlackLedgerResult): string {
  return ledger.task.created
    ? `Got it — logged on Regi as “${ledger.task.title}” (task #${ledger.task.number}).`
    : `Updated Regi task #${ledger.task.number} (“${ledger.task.title}”).`;
}

function excludeJustCreatedQueryTask(
  tasks: NumberedProjectTask[],
  ledger: SlackLedgerResult | undefined,
): NumberedProjectTask[] {
  if (!ledger?.task.created) return tasks;
  return tasks.filter((task) => task.id !== ledger.task.id);
}

function formatAssigneeStatus(
  name: string,
  projectName: string,
  tasks: NumberedProjectTask[],
): string {
  if (!tasks.length) {
    return `No remaining ${projectName} tasks assigned to ${name}.`;
  }
  return [
    `Remaining ${projectName} tasks assigned to ${name}:`,
    "",
    ...formatRemainingTaskLines(tasks),
  ].join("\n");
}

export async function buildSlackLocalReply(input: {
  text: string;
  roster: Extract<SlackRosterLookupResult, { found: true }>;
  ledger?: SlackLedgerResult;
}): Promise<SlackLocalReply> {
  const kind = classifySlackLocalIntent(input.text);
  const ack = {
    kind: "ack" as const,
    text: input.ledger
      ? formatSlackLedgerAck(input.ledger)
      : "Got it — I couldn't log that on Regi just now.",
  };

  if (kind === "ack") return ack;

  try {
    const projectKey = resolveRegiProjectKey();
    const projectName = displayProjectName(projectKey);
    const remaining = excludeJustCreatedQueryTask(
      await listProjectTasks({ project: projectKey }),
      input.ledger,
    );

    if (kind === "assignee_status") {
      const mine = remaining.filter(
        (task) => task.assigneeUserId === input.roster.user.id,
      );
      return {
        kind,
        text: formatAssigneeStatus(input.roster.user.name, projectName, mine),
      };
    }

    return {
      kind,
      text: formatRemainingTasksMessage({
        projectKey,
        projectName,
        tasks: remaining,
      }),
    };
  } catch (error) {
    logger.error("slack_local_reply_list_failed", {
      kind,
      error: error instanceof Error ? error.message : "unknown",
    });
    if (input.ledger) return ack;
    return {
      kind,
      text: "Couldn't load remaining tasks for Regi right now.",
    };
  }
}
