/**
 * Send a user's open tasks over RCS as rich cards, or as a numbered SMS list.
 * Done uses completeProjectTask — the same status: "done" path as the whiteboard.
 * A Done tap can complete any open task on the sender's projects, including
 * tasks the All filter shows for someone else. The numbered SMS list is still
 * that sender's own tasks.
 */

import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import {
  completeProjectTask,
  getProjectTask,
  listProjectTasks,
} from "@/lib/project-tasks/store";
import { REMAINING_STATUSES } from "@/lib/project-tasks/types";
import { isRcsMessageType } from "./inbound";
import { sendRcsContent, sendReply, type SendMessageResult } from "./client";
import {
  buildTaskRcsCard,
  cardsInTaskRcsPart,
  classifyInboundTask,
  formatOpenTaskSms,
  formatTaskDoneReply,
  planTaskRcsParts,
  taskBelongsToUser,
  taskCardDue,
  taskCardTitle,
  taskOwnerLabel,
  taskRcsPartToContent,
  type InboundTaskIntent,
  type OpenTaskCardInput,
  type TaskCardViewer,
} from "./task-cards";

export type OpenTaskForCard = OpenTaskCardInput & {
  rawTitle: string;
};

const NOT_ON_LIST = "That task isn't on your open list.";

function ownerName(
  task: { title: string; assigneeUserId: string | null },
  names: Map<string, string>,
): string {
  if (task.assigneeUserId) {
    return names.get(task.assigneeUserId)?.trim() || "Unassigned";
  }
  return taskOwnerLabel(task.title) || "Unassigned";
}

export async function listUserOpenTasks(
  user: TaskCardViewer,
  projectKeys: string[],
): Promise<OpenTaskForCard[]> {
  const collected: Array<{
    id: string;
    title: string;
    description: string;
    assigneeUserId: string | null;
    dueAt: Date | null;
  }> = [];

  for (const project of projectKeys) {
    const tasks = await listProjectTasks({ project });
    for (const task of tasks) {
      if (!taskBelongsToUser(task, user)) continue;
      collected.push({
        id: task.id,
        title: task.title,
        description: task.description,
        assigneeUserId: task.assigneeUserId,
        dueAt: task.dueAt,
      });
    }
  }

  const assigneeIds = [
    ...new Set(
      collected
        .map((task) => task.assigneeUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const people = assigneeIds.length
    ? await prisma.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true, username: true },
      })
    : [];
  const names = new Map(
    people.map((person) => [
      person.id,
      person.name.trim() || person.username.trim(),
    ]),
  );

  return collected.map((task) => ({
    id: task.id,
    rawTitle: task.title,
    title: taskCardTitle(task.title),
    owner: ownerName(task, names),
    due: taskCardDue(task),
  }));
}

async function sendText(
  to: string,
  text: string,
  preferRcs: boolean,
): Promise<SendMessageResult> {
  return sendReply(to, text, preferRcs, { allowSmsFallback: true });
}

export async function sendOpenTaskList(input: {
  to: string;
  preferRcs: boolean;
  tasks: OpenTaskForCard[];
}): Promise<SendMessageResult> {
  const sms = formatOpenTaskSms(input.tasks);
  if (!input.tasks.length || !input.preferRcs) {
    return sendText(input.to, sms, input.preferRcs && input.tasks.length === 0);
  }

  const cards = input.tasks.map((task) => buildTaskRcsCard(task));
  const parts = planTaskRcsParts(cards);
  let sentCards = 0;
  let last: SendMessageResult = { sent: false, error: "No task cards to send" };

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (!part) continue;
    const result = await sendRcsContent({
      to: input.to,
      content: taskRcsPartToContent(part),
      smsText: sentCards === 0 ? sms : undefined,
    });
    last = result;
    if (result.sent && isRcsMessageType(result.type)) {
      sentCards += cardsInTaskRcsPart(part);
      continue;
    }
    if (sentCards === 0) return result;

    const remainder = formatOpenTaskSms(
      input.tasks.slice(sentCards),
      sentCards + 1,
    );
    logger.warn("rcs_task_cards_remainder_sms", {
      sentCards,
      remaining: input.tasks.length - sentCards,
      error: result.error ?? null,
    });
    return sendText(input.to, remainder, false);
  }

  logger.info("rcs_task_cards_sent", {
    tasks: input.tasks.length,
    parts: parts.length,
    type: last.type ?? null,
  });
  return last;
}

async function completeVisibleTask(
  projectKeys: string[],
  taskId: string,
): Promise<string> {
  const task = await getProjectTask(taskId);
  if (!task || !projectKeys.includes(task.projectKey)) return NOT_ON_LIST;
  if (task.status === "done") return formatTaskDoneReply(task.title, true);
  if (!REMAINING_STATUSES.includes(task.status)) return NOT_ON_LIST;

  const updated = await completeProjectTask({ taskId: task.id });
  return formatTaskDoneReply(updated.title, false);
}

async function completeOwnedTaskByNumber(
  user: TaskCardViewer,
  projectKeys: string[],
  number: number,
): Promise<string> {
  const tasks = await listUserOpenTasks(user, projectKeys);
  if (!tasks.length) return "No open tasks.";
  const task = tasks[number - 1];
  if (!task) {
    const noun = tasks.length === 1 ? "task" : "tasks";
    return `No open task ${number}. You have ${tasks.length} open ${noun}.`;
  }
  return completeVisibleTask(projectKeys, task.id);
}

export async function deliverInboundTaskIntent(input: {
  to: string;
  preferRcs: boolean;
  user: TaskCardViewer;
  projectKeys: string[];
  intent: InboundTaskIntent;
}): Promise<SendMessageResult> {
  try {
    if (input.intent.kind === "list") {
      const tasks = await listUserOpenTasks(input.user, input.projectKeys);
      return sendOpenTaskList({
        to: input.to,
        preferRcs: input.preferRcs,
        tasks,
      });
    }

    const text =
      input.intent.kind === "done-id"
        ? await completeVisibleTask(input.projectKeys, input.intent.taskId)
        : await completeOwnedTaskByNumber(
            input.user,
            input.projectKeys,
            input.intent.number,
          );
    return sendText(input.to, text, input.preferRcs);
  } catch (error) {
    logger.error("rcs_task_delivery_failed", {
      kind: input.intent.kind,
      error: error instanceof Error ? error.message : "unknown",
    });
    const text =
      input.intent.kind === "list"
        ? "I couldn't load your open tasks just now."
        : "I couldn't mark that task done.";
    return sendText(input.to, text, input.preferRcs);
  }
}

export async function maybeDeliverInboundTasks(input: {
  to: string;
  text: string;
  postback?: string | null;
  preferRcs: boolean;
  user: TaskCardViewer;
  projectKeys: string[];
}): Promise<SendMessageResult | null> {
  const intent = classifyInboundTask(input.text, input.postback);
  if (!intent) return null;
  return deliverInboundTaskIntent({
    to: input.to,
    preferRcs: input.preferRcs,
    user: input.user,
    projectKeys: input.projectKeys,
    intent,
  });
}
