/**
 * @deprecated Prefer lib/connectors — Chief of Staff Engine consumes normalized events.
 * This module remains only for reference/compat; scans no longer call it.
 */
import { collectGitHubAttentionSignals } from "@/lib/github/attention";
import { isGitHubConfigured } from "@/lib/github/config";
import { getMicrosoftConfig } from "@/lib/microsoft/config";
import { graphRequest, userPath } from "@/lib/microsoft/graph";
import type { CollectedSignal } from "@/lib/attention/types";
import { logger } from "@/lib/logger";

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function collectEmails(): Promise<CollectedSignal[]> {
  const params = new URLSearchParams({
    $top: "25",
    $select:
      "id,subject,from,receivedDateTime,isRead,bodyPreview,conversationId,hasAttachments,importance,body",
    $orderby: "receivedDateTime desc",
    $filter: "receivedDateTime ge " + new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  });

  const data = await graphRequest<{
    value?: Array<{
      id: string;
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      isRead?: boolean;
      bodyPreview?: string;
      conversationId?: string;
      hasAttachments?: boolean;
      importance?: string;
      body?: { contentType?: string; content?: string };
    }>;
  }>(userPath(`/mailFolders/inbox/messages?${params}`));

  return (data.value || []).map((message) => {
    const sender =
      message.from?.emailAddress?.name ||
      message.from?.emailAddress?.address ||
      "Unknown sender";
    const bodyText =
      message.body?.contentType?.toLowerCase() === "html"
        ? htmlToText(message.body.content || "")
        : (message.body?.content || "").trim();
    const preview = (bodyText || message.bodyPreview || "").slice(0, 2500);
    return {
      source: "email" as const,
      sourceId: message.id,
      sender,
      subject: message.subject || "(no subject)",
      preview,
      receivedAt: message.receivedDateTime,
      raw: {
        isRead: message.isRead,
        conversationId: message.conversationId,
        hasAttachments: message.hasAttachments,
        importance: message.importance,
        fromAddress: message.from?.emailAddress?.address,
      },
    };
  });
}

async function collectCalendar(): Promise<CollectedSignal[]> {
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $top: "30",
    $orderby: "start/dateTime",
    $select:
      "id,subject,start,end,location,organizer,isCancelled,responseStatus,bodyPreview,attendees,showAs,type",
  });

  const data = await graphRequest<{
    value?: Array<{
      id: string;
      subject?: string;
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
      location?: { displayName?: string };
      organizer?: { emailAddress?: { name?: string; address?: string } };
      isCancelled?: boolean;
      responseStatus?: { response?: string };
      bodyPreview?: string;
      attendees?: unknown[];
      showAs?: string;
      type?: string;
    }>;
  }>(userPath(`/calendarView?${params}`));

  return (data.value || []).map((event) => {
    const organizer =
      event.organizer?.emailAddress?.name ||
      event.organizer?.emailAddress?.address ||
      "Calendar";
    const response = event.responseStatus?.response || "none";
    const preview = [
      `Organizer: ${organizer}`,
      `Start: ${event.start?.dateTime || "unknown"} (${event.start?.timeZone || ""})`,
      `End: ${event.end?.dateTime || "unknown"}`,
      `Location: ${event.location?.displayName || "n/a"}`,
      `Response status: ${response}`,
      `Cancelled: ${Boolean(event.isCancelled)}`,
      event.bodyPreview || "",
    ].join("\n");

    const isInvite =
      response === "notResponded" ||
      response === "none" ||
      response === "tentativelyAccepted";

    return {
      source: (isInvite ? "meeting_invite" : "calendar") as CollectedSignal["source"],
      sourceId: event.id,
      sender: organizer,
      subject: event.subject || "(no subject)",
      preview: preview.slice(0, 2500),
      receivedAt: event.start?.dateTime,
      raw: {
        responseStatus: response,
        isCancelled: event.isCancelled,
        showAs: event.showAs,
        type: event.type,
        startDateTime: event.start?.dateTime,
        endDateTime: event.end?.dateTime,
        timeZone: event.start?.timeZone,
      },
    };
  });
}

async function collectTodos(): Promise<CollectedSignal[]> {
  const lists = await graphRequest<{
    value?: Array<{ id: string; displayName?: string }>;
  }>(userPath("/todo/lists"));

  const signals: CollectedSignal[] = [];
  for (const list of (lists.value || []).slice(0, 8)) {
    const tasks = await graphRequest<{
      value?: Array<{
        id: string;
        title?: string;
        body?: { content?: string };
        dueDateTime?: { dateTime?: string };
        importance?: string;
        status?: string;
        createdDateTime?: string;
      }>;
    }>(
      userPath(
        `/todo/lists/${encodeURIComponent(list.id)}/tasks?$top=20&$filter=status ne 'completed'`,
      ),
    );

    for (const task of tasks.value || []) {
      signals.push({
        source: "todo",
        sourceId: `${list.id}:${task.id}`,
        sender: list.displayName || "To Do",
        subject: task.title || "(untitled task)",
        preview: [
          `List: ${list.displayName || "To Do"}`,
          `Importance: ${task.importance || "normal"}`,
          `Due: ${task.dueDateTime?.dateTime || "none"}`,
          task.body?.content || "",
        ]
          .join("\n")
          .slice(0, 2500),
        receivedAt: task.createdDateTime,
        raw: {
          listId: list.id,
          taskId: task.id,
          dueDateTime: task.dueDateTime?.dateTime,
          importance: task.importance,
          status: task.status,
        },
      });
    }
  }
  return signals;
}

export async function collectAttentionSignals(): Promise<CollectedSignal[]> {
  const ms = Boolean(getMicrosoftConfig());
  const gh = isGitHubConfigured();
  if (!ms && !gh) {
    throw new Error("Neither Microsoft 365 nor GitHub is configured.");
  }

  const tasks: Array<Promise<CollectedSignal[]>> = [];
  const labels: string[] = [];

  if (ms) {
    tasks.push(collectEmails(), collectCalendar(), collectTodos());
    labels.push("email", "calendar", "todo");
  }
  if (gh) {
    tasks.push(collectGitHubAttentionSignals());
    labels.push("github");
  }

  const results = await Promise.allSettled(tasks);
  const signals: CollectedSignal[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      signals.push(...result.value);
    } else {
      logger.warn("attention_collect_partial_failure", {
        source: labels[index],
        error:
          result.reason instanceof Error ? result.reason.message : "unknown",
      });
    }
  });

  return signals;
}
