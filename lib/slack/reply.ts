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

function normalizeIntentText(text: string): string {
  return text
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Tight matchers for list/status asks — work requests stay on the ack path. */
export function classifySlackLocalIntent(text: string): SlackLocalReplyKind {
  const normalized = normalizeIntentText(text);
  if (!normalized) return "ack";

  if (
    /\b(my remaining tasks?|my tasks?|assigned to me|on my plate|my backlog|my status)\b/.test(
      normalized,
    ) ||
    /^(status|what(?:'s| is) (?:my )?status)$/.test(normalized)
  ) {
    return "assignee_status";
  }

  if (
    /\bshow remaining tasks\b/.test(normalized) ||
    /^(?:show|list|recite)(?: me)?(?: the)? remaining tasks?\b/.test(
      normalized,
    ) ||
    /^(?:what(?:'s| is| are)|whats)(?: the)? remaining(?: tasks?)?\b/.test(
      normalized,
    ) ||
    /^(?:remaining tasks?|task list|list tasks?|show tasks?|what'?s left)$/.test(
      normalized,
    )
  ) {
    return "remaining_tasks";
  }

  return "ack";
}

export function formatSlackLedgerAck(ledger: SlackLedgerResult): string {
  return ledger.task.created
    ? `Got it — logged on Regi as “${ledger.task.title}” (task #${ledger.task.number}).`
    : `Updated Regi task #${ledger.task.number} (“${ledger.task.title}”).`;
}

function excludeJustCreatedQueryTask(
  tasks: NumberedProjectTask[],
  ledger: SlackLedgerResult,
): NumberedProjectTask[] {
  if (!ledger.task.created) return tasks;
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
  const numbered = tasks.map((task, index) => ({
    number: index + 1,
    title: task.title,
  }));
  return [
    `Remaining ${projectName} tasks assigned to ${name}:`,
    "",
    ...formatRemainingTaskLines(numbered),
  ].join("\n");
}

export async function buildSlackLocalReply(input: {
  text: string;
  roster: Extract<SlackRosterLookupResult, { found: true }>;
  ledger: SlackLedgerResult;
}): Promise<SlackLocalReply> {
  const kind = classifySlackLocalIntent(input.text);
  const ack = { kind: "ack" as const, text: formatSlackLedgerAck(input.ledger) };

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
    return ack;
  }
}
