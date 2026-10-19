/**
 * Grok Bot task change notifications.
 *
 * Each project member with a bot receives one POST. URLs are deduped.
 * Members without a bot share a single fallback POST to the env Dina bot.
 * When nobody can be notified, the change is logged.
 */

import { logger } from "@/lib/logger";
import { resolveTaskGrokBots } from "@/lib/grok-api/bots";
import { buildGrokBotWebhookHeaders } from "@/lib/grok-api/webhook-headers";
import type { GrokBotConfig } from "@/lib/telnyx/config";
import type { ProjectTaskStatus } from "@/lib/project-tasks/types";

export type TaskAssigneePayload = {
  email: string;
  name: string;
} | null;

export interface TaskChangePayload {
  event: "task.created" | "task.updated";
  projectKey: string;
  task: {
    id: string;
    number: number;
    title: string;
    description: string;
    status: ProjectTaskStatus;
    section?: string | null;
    assignee?: TaskAssigneePayload;
  };
  changes?: {
    status?: ProjectTaskStatus;
    title?: string;
    description?: string;
    section?: string | null;
    assignee?: TaskAssigneePayload;
  };
}

export interface TaskChangeResult {
  status: "sent" | "logged" | "error";
  error?: string;
}

async function postTaskChange(
  target: GrokBotConfig,
  payload: TaskChangePayload,
  body: string,
): Promise<string | null> {
  const headers = buildGrokBotWebhookHeaders(body, target.webhookSecret);
  try {
    const response = await fetch(target.webhookUrl, {
      method: "POST",
      headers,
      body,
    });
    if (!response.ok) {
      const errorText = await response.text();
      logger.error("grok_bot_task_change_failed", {
        event: payload.event,
        projectKey: payload.projectKey,
        taskId: payload.task.id,
        status: response.status,
        error: errorText,
      });
      return `Grok Bot returned ${response.status}: ${errorText}`;
    }
    return null;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    logger.error("grok_bot_task_change_error", {
      event: payload.event,
      projectKey: payload.projectKey,
      taskId: payload.task.id,
      error: errorMsg,
    });
    return errorMsg;
  }
}

export async function notifyTaskChange(
  payload: TaskChangePayload,
): Promise<TaskChangeResult> {
  let targets;
  try {
    targets = await resolveTaskGrokBots(payload.projectKey);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    logger.error("grok_bot_task_change_error", {
      event: payload.event,
      projectKey: payload.projectKey,
      taskId: payload.task.id,
      error: errorMsg,
    });
    return { status: "error", error: errorMsg };
  }

  if (targets.length === 0) {
    logger.info("grok_bot_task_change_logged", {
      event: payload.event,
      projectKey: payload.projectKey,
      taskId: payload.task.id,
      taskNumber: payload.task.number,
      status: payload.task.status,
      reason: "grok_bot_not_configured",
    });
    return { status: "logged" };
  }

  const body = JSON.stringify({
    type: payload.event,
    projectKey: payload.projectKey,
    task: payload.task,
    changes: payload.changes,
    timestamp: new Date().toISOString(),
  });

  const errors: string[] = [];
  for (const target of targets) {
    const error = await postTaskChange(target, payload, body);
    if (error) errors.push(error);
  }

  if (errors.length > 0) {
    return { status: "error", error: errors.join("; ") };
  }

  logger.info("grok_bot_task_change_sent", {
    event: payload.event,
    projectKey: payload.projectKey,
    taskId: payload.task.id,
    taskNumber: payload.task.number,
    taskStatus: payload.task.status,
    targets: targets.length,
  });

  return { status: "sent" };
}
