/**
 * Grok Bot task change notifications.
 *
 * When GROK_BOT_DINA_WEBHOOK_URL is set, task changes are forwarded.
 * When unset, changes are logged (no-op) like Telnyx handoff.
 */

import { createHmac } from "crypto";
import { logger } from "@/lib/logger";
import { getGrokBotConfig, isGrokBotConfigured } from "@/lib/telnyx/config";
import type { ProjectTaskStatus } from "@/lib/project-tasks/types";

export interface TaskChangePayload {
  event: "task.created" | "task.updated";
  projectKey: string;
  task: {
    id: string;
    number: number;
    title: string;
    description: string;
    status: ProjectTaskStatus;
  };
  changes?: {
    status?: ProjectTaskStatus;
    title?: string;
    description?: string;
  };
}

export interface TaskChangeResult {
  status: "sent" | "logged" | "error";
  error?: string;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function notifyTaskChange(
  payload: TaskChangePayload,
): Promise<TaskChangeResult> {
  if (!isGrokBotConfigured()) {
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

  const config = getGrokBotConfig();
  if (!config) {
    return { status: "logged" };
  }

  const body = JSON.stringify({
    type: payload.event,
    projectKey: payload.projectKey,
    task: payload.task,
    changes: payload.changes,
    timestamp: new Date().toISOString(),
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.webhookSecret) {
    const signature = signPayload(body, config.webhookSecret);
    headers["X-Grok-Bot-Signature"] = signature;
    headers["X-Grok-Bot-Timestamp"] = String(Math.floor(Date.now() / 1000));
  }

  try {
    const response = await fetch(config.webhookUrl, {
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
      return {
        status: "error",
        error: `Grok Bot returned ${response.status}: ${errorText}`,
      };
    }

    logger.info("grok_bot_task_change_sent", {
      event: payload.event,
      projectKey: payload.projectKey,
      taskId: payload.task.id,
      taskNumber: payload.task.number,
      taskStatus: payload.task.status,
    });

    return { status: "sent" };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "unknown error";
    logger.error("grok_bot_task_change_error", {
      event: payload.event,
      projectKey: payload.projectKey,
      taskId: payload.task.id,
      error: errorMsg,
    });
    return {
      status: "error",
      error: errorMsg,
    };
  }
}
