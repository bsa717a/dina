/**
 * RCS rich cards for a user's open tasks, plus the plain SMS list.
 *
 * Telnyx limits (POST /v2/messages/rcs):
 * - Carousel: 2–10 cards
 * - Card title: 200 characters
 * - Card description: 2000 characters
 * - Suggestions on a card: 10
 * - Suggested-action label: 25 characters
 * - postback_data: 2048 characters
 *
 * More than 10 open tasks are sent as further carousels. A single leftover
 * card is a standalone rich card, because a carousel cannot contain 1 card.
 */

import { taskOwnedByViewer, taskOwnerLabel } from "@/lib/client/whiteboard";
import type {
  TelnyxRcsCardContent,
  TelnyxRcsContentMessage,
} from "./types";

export { taskOwnerLabel };

export const RCS_CAROUSEL_MIN = 2;
export const RCS_CAROUSEL_MAX = 10;
export const RCS_CARD_TITLE_MAX = 200;
export const RCS_CARD_DESCRIPTION_MAX = 2000;
export const RCS_CARD_SUGGESTIONS_MAX = 10;
export const RCS_SUGGESTION_TEXT_MAX = 25;
export const RCS_POSTBACK_MAX = 2048;

export const TASK_DONE_ACTION_TEXT = "Done";
export const TASK_DONE_POSTBACK_PREFIX = "piper-task-done:";

export type TaskCardViewer = {
  id: string;
  name?: string | null;
  username?: string | null;
};

export type OpenTaskCardInput = {
  id: string;
  title: string;
  owner: string;
  due: string | null;
};

export type TaskRcsCard = TelnyxRcsCardContent;

export type TaskRcsPart =
  | { kind: "carousel"; cards: TaskRcsCard[] }
  | { kind: "standalone"; card: TaskRcsCard };

const DUE_PATTERN =
  /\bdue:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?)/i;

export function truncateRcsText(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

export function taskDueLabel(title: string, description = ""): string | null {
  const match = `${title}\n${description}`.match(DUE_PATTERN);
  const label = match?.[1]?.trim() ?? "";
  return label || null;
}

/** Card title without the owner/due parenthetical. */
export function taskCardTitle(title: string): string {
  const stripped = title
    .replace(/\s*\((?=[^)]*\b(?:owner|due)\b)[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = stripped || title.trim() || "Untitled task";
  return truncateRcsText(base, RCS_CARD_TITLE_MAX);
}

export function taskDonePostback(taskId: string): string {
  const id = taskId.trim();
  const data = `${TASK_DONE_POSTBACK_PREFIX}${id}`;
  if (!id || data.length > RCS_POSTBACK_MAX) {
    throw new Error("Task postback exceeds the Telnyx 2048 character limit");
  }
  return data;
}

export function taskIdFromPostback(postback: string | null | undefined): string | null {
  const value = postback?.trim() ?? "";
  if (!value.startsWith(TASK_DONE_POSTBACK_PREFIX)) return null;
  const id = value.slice(TASK_DONE_POSTBACK_PREFIX.length).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  return id;
}

/**
 * Same Mine rule as the whiteboard: assignee id, otherwise "owner: …" in the title.
 */
export function taskBelongsToUser(
  task: { title: string; assigneeUserId?: string | null },
  user: TaskCardViewer,
): boolean {
  return taskOwnedByViewer(task, user);
}

export function buildTaskRcsCard(input: OpenTaskCardInput): TaskRcsCard {
  const owner = truncateRcsText(input.owner.trim() || "Unassigned", 200);
  const due = input.due?.trim()
    ? truncateRcsText(input.due.trim(), 80)
    : "No due date";
  const description = truncateRcsText(
    `Owner: ${owner}\nDue: ${due}`,
    RCS_CARD_DESCRIPTION_MAX,
  );
  const actionText = truncateRcsText(TASK_DONE_ACTION_TEXT, RCS_SUGGESTION_TEXT_MAX);
  return {
    title: taskCardTitle(input.title),
    description,
    suggestions: [
      {
        action: {
          text: actionText,
          postback_data: taskDonePostback(input.id),
        },
      },
    ].slice(0, RCS_CARD_SUGGESTIONS_MAX),
  };
}

/**
 * One carousel per 10 cards. A remainder of 1 is a standalone rich card
 * (Telnyx carousels require 2–10 cards).
 */
export function planTaskRcsParts(cards: TaskRcsCard[]): TaskRcsPart[] {
  const parts: TaskRcsPart[] = [];
  let index = 0;
  while (index < cards.length) {
    const remaining = cards.length - index;
    if (remaining < RCS_CAROUSEL_MIN) {
      const card = cards[index];
      if (card) parts.push({ kind: "standalone", card });
      break;
    }
    const take = Math.min(RCS_CAROUSEL_MAX, remaining);
    const chunk = cards.slice(index, index + take);
    parts.push({ kind: "carousel", cards: chunk });
    index += take;
  }
  return parts;
}

export function taskRcsPartToContent(part: TaskRcsPart): TelnyxRcsContentMessage {
  if (part.kind === "standalone") {
    return {
      rich_card: {
        standalone_card: {
          card_orientation: "VERTICAL",
          card_content: part.card,
        },
      },
    };
  }
  return {
    rich_card: {
      carousel_card: {
        card_width: "MEDIUM",
        card_contents: part.cards,
      },
    },
  };
}

export function cardsInTaskRcsPart(part: TaskRcsPart): number {
  return part.kind === "carousel" ? part.cards.length : 1;
}

export type SmsTaskLine = {
  title: string;
  owner: string;
  due: string | null;
};

export function formatOpenTaskSms(tasks: SmsTaskLine[], startNumber = 1): string {
  if (!tasks.length) return "No open tasks.";
  const lines = [startNumber > 1 ? "Open tasks continued:" : "Open tasks:"];
  tasks.forEach((task, index) => {
    const due = task.due?.trim() ? `due ${task.due.trim()}` : "no due date";
    const owner = task.owner.trim() || "Unassigned";
    lines.push(`${startNumber + index}. ${task.title} — ${owner} — ${due}`);
  });
  lines.push("Reply done N to complete task N.");
  return lines.join("\n");
}

export function formatTaskDoneReply(title: string, alreadyDone: boolean): string {
  const name = taskCardTitle(title);
  return alreadyDone ? `✅ ${name} is already done.` : `✅ ${name}`;
}

export function parseDoneCommand(text: string): number | null {
  const normalized = text.trim().replace(/[.!?]+$/g, "").trim();
  const match = normalized.match(/^done\s+#?(\d+)$/i);
  if (!match?.[1]) return null;
  const number = Number(match[1]);
  if (!Number.isInteger(number) || number < 1 || number > 9999) return null;
  return number;
}

const POLITE_PREFIX = /^(?:(?:please|hey|hi|ok|okay|piper)\s+)+/;

export function isOpenTaskListAsk(text: string): boolean {
  let normalized = text
    .trim()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  let previous = "";
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(POLITE_PREFIX, "").trim();
  }
  if (!normalized || parseDoneCommand(normalized) != null) return false;
  return (
    /^(?:show|list|send|get|give)(?:\s+me)?(?:\s+my)?(?:\s+open)?\s+tasks?$/.test(
      normalized,
    ) ||
    /^(?:my\s+)?(?:open\s+)?tasks$/.test(normalized) ||
    /^(?:my\s+task|open\s+task|my\s+open\s+task)$/.test(normalized) ||
    /^what(?:'s|s| are| is)\s+my\s+(?:open\s+)?tasks?$/.test(normalized) ||
    /^(?:what(?:'s|s| is)\s+left|what'?s\s+on\s+my\s+plate|task\s+list)$/.test(
      normalized,
    )
  );
}

export type InboundTaskIntent =
  | { kind: "list" }
  | { kind: "done-id"; taskId: string }
  | { kind: "done-number"; number: number };

export function classifyInboundTask(
  text: string,
  postback?: string | null,
): InboundTaskIntent | null {
  const taskId = taskIdFromPostback(postback);
  if (taskId) return { kind: "done-id", taskId };
  const number = parseDoneCommand(text);
  if (number != null) return { kind: "done-number", number };
  if (isOpenTaskListAsk(text)) return { kind: "list" };
  return null;
}
