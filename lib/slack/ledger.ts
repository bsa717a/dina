/**
 * Create or update a Regi ProjectTask + Attention item for a Slack thread.
 */

import { prisma } from "@/lib/db/client";
import {
  addProjectTask,
  listProjectTasks,
  updateProjectTask,
} from "@/lib/project-tasks/store";
import { resolveRegiProjectKey } from "./scope";
import type { SlackInboundEvent, SlackRosterLookupResult, SlackThreadMeta } from "./types";

const ATTENTION_SOURCE = "slack";

export function slackThreadSourceId(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

export function stripSlackMentions(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+>/gi, "")
    .replace(/<#[A-Z0-9]+\|[^>]+>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function titleFromSlackText(text: string, threadTs: string): string {
  const cleaned = stripSlackMentions(text);
  const firstLine = cleaned.split("\n")[0]?.trim() ?? "";
  const truncated = firstLine.slice(0, 80);
  if (truncated.length < 3) {
    return `Slack thread ${threadTs}`;
  }
  return truncated;
}

function parseThreadMeta(rawJson: string | null): SlackThreadMeta | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as Partial<SlackThreadMeta>;
    if (
      typeof parsed.taskId === "string" &&
      typeof parsed.channelId === "string" &&
      typeof parsed.threadTs === "string" &&
      typeof parsed.projectKey === "string"
    ) {
      return {
        taskId: parsed.taskId,
        channelId: parsed.channelId,
        threadTs: parsed.threadTs,
        slackUserId: typeof parsed.slackUserId === "string" ? parsed.slackUserId : "",
        projectKey: parsed.projectKey,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export interface SlackLedgerResult {
  task: {
    id: string;
    number: number;
    title: string;
    created: boolean;
  };
  attention: { id: string };
}

export async function findSlackThreadAttention(
  channelId: string,
  threadTs: string,
) {
  return prisma.attentionItem.findUnique({
    where: {
      source_sourceId: {
        source: ATTENTION_SOURCE,
        sourceId: slackThreadSourceId(channelId, threadTs),
      },
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}

export async function upsertSlackThreadLedger(input: {
  event: SlackInboundEvent;
  roster: Extract<SlackRosterLookupResult, { found: true }>;
}): Promise<SlackLedgerResult> {
  const projectKey = resolveRegiProjectKey();
  const sourceId = slackThreadSourceId(input.event.channelId, input.event.threadTs);
  const cleaned = stripSlackMentions(input.event.text) || input.event.text;
  const sender = input.roster.user.name;

  const existing = await prisma.attentionItem.findUnique({
    where: {
      source_sourceId: { source: ATTENTION_SOURCE, sourceId },
    },
  });

  const existingMeta = parseThreadMeta(existing?.rawJson ?? null);
  let taskId = existingMeta?.taskId;
  let created = false;
  let title = existing?.subject || titleFromSlackText(input.event.text, input.event.threadTs);

  if (taskId) {
    const prior = await prisma.projectTask.findUnique({ where: { id: taskId } });
    if (!prior || prior.projectKey !== projectKey) {
      taskId = undefined;
    } else {
      const stamp = new Date().toISOString();
      const addition = `\n\n[${stamp} ${sender}]\n${cleaned}`;
      await updateProjectTask(prior.id, {
        description: `${prior.description || ""}${addition}`.slice(0, 8000),
      });
    }
  }

  if (!taskId) {
    title = titleFromSlackText(input.event.text, input.event.threadTs);
    try {
      const createdTask = await addProjectTask({
        project: projectKey,
        title,
        description: `[Slack ${input.event.channelId}/${input.event.threadTs}]\n${cleaned}`,
        source: "slack",
        createdByUserId: input.roster.user.id,
        assigneeUserId: input.roster.user.id,
      });
      taskId = createdTask.id;
      created = true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        title = `${title} (${input.event.threadTs})`.slice(0, 120);
        const createdTask = await addProjectTask({
          project: projectKey,
          title,
          description: `[Slack ${input.event.channelId}/${input.event.threadTs}]\n${cleaned}`,
          source: "slack",
          createdByUserId: input.roster.user.id,
          assigneeUserId: input.roster.user.id,
        });
        taskId = createdTask.id;
        created = true;
      } else {
        throw error;
      }
    }
  }

  const meta: SlackThreadMeta = {
    taskId,
    channelId: input.event.channelId,
    threadTs: input.event.threadTs,
    slackUserId: input.event.slackUserId,
    projectKey,
  };

  const summary = created
    ? `${sender} asked Piper via Slack: ${cleaned.slice(0, 280)}`
    : `${sender} followed up in Slack: ${cleaned.slice(0, 280)}`;

  const attention = existing
    ? await prisma.attentionItem.update({
        where: { id: existing.id },
        data: {
          sender,
          subject: title,
          summary,
          lastSeenAt: new Date(),
          status: existing.status === "snoozed" ? existing.status : "open",
          rawJson: JSON.stringify(meta),
        },
      })
    : await prisma.attentionItem.create({
        data: {
          source: ATTENTION_SOURCE,
          sourceId,
          category: "reply_required",
          status: "open",
          sender,
          subject: title,
          summary,
          whyItMatters: "A Regi teammate reached Piper from Slack.",
          recommendedAction: "Reply in the Slack thread or update the Regi task.",
          needsResponse: true,
          hasDeadline: false,
          isBlocking: false,
          canWait: true,
          shouldDraftReply: false,
          notifyNow: true,
          notificationTitle: `Regi · Slack from ${sender}`,
          notificationBody: cleaned.slice(0, 160),
          rawJson: JSON.stringify(meta),
        },
      });

  const numbered = await listProjectTasks({
    project: projectKey,
    includeDone: true,
  });
  const match = numbered.find((task) => task.id === taskId);

  return {
    task: {
      id: taskId,
      number: match?.number ?? 0,
      title: match?.title ?? title,
      created,
    },
    attention: { id: attention.id },
  };
}
