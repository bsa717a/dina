import type { NormalizedEvent } from "@/lib/chief-of-staff/types";
import type { Connector } from "@/lib/connectors/types";
import {
  listAttentionBlocks,
  partitionByAttentionBlocks,
} from "@/lib/attention/blocks";
import { getMicrosoftConfig } from "@/lib/microsoft/config";
import { graphRequest, userPath } from "@/lib/microsoft/graph";
import { partitionMailByTriage } from "@/lib/mail/triage";
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

async function markMessagesRead(ids: string[]) {
  let success = 0;
  for (const id of ids) {
    try {
      await graphRequest(userPath(`/messages/${encodeURIComponent(id)}`), {
        method: "PATCH",
        body: { isRead: true },
      });
      success += 1;
    } catch (error) {
      logger.warn("connector_microsoft_mark_read_failed", {
        messageId: id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return success;
}

async function emitMail(): Promise<NormalizedEvent[]> {
  // Header/preview first — avoid spending CoS tokens on marketing/spam bodies.
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const listParams = new URLSearchParams({
    $top: "40",
    $select:
      "id,subject,from,receivedDateTime,isRead,bodyPreview,conversationId,hasAttachments,importance,inferenceClassification",
    $orderby: "receivedDateTime desc",
    $filter: `receivedDateTime ge ${since} and isRead eq false`,
  });

  const listed = await graphRequest<{
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
      inferenceClassification?: string;
    }>;
  }>(userPath(`/mailFolders/inbox/messages?${listParams}`));

  const config = getMicrosoftConfig();
  const messages = listed.value || [];
  const mapped = messages.map((message) => ({
    id: message.id,
    subject: message.subject,
    fromAddress: message.from?.emailAddress?.address,
    fromName: message.from?.emailAddress?.name,
    bodyPreview: message.bodyPreview,
    inferenceClassification: message.inferenceClassification,
    message,
  }));

  const blocks = await listAttentionBlocks();
  const { blocked, allowed } = partitionByAttentionBlocks(mapped, blocks);

  if (blocked.length) {
    const marked = await markMessagesRead(blocked.map((item) => item.id));
    logger.info("connector_microsoft_blocked_cleared", {
      blocked: blocked.length,
      markedRead: marked,
      samples: blocked.slice(0, 8).map((item) => ({
        subject: item.subject,
        from: item.fromAddress,
        reason: item.blockReason,
      })),
    });
  }

  const { noise, maybeReal } = partitionMailByTriage(allowed);

  if (noise.length) {
    const marked = await markMessagesRead(noise.map((item) => item.id));
    logger.info("connector_microsoft_noise_cleared", {
      noise: noise.length,
      markedRead: marked,
      samples: noise.slice(0, 8).map((item) => ({
        subject: item.subject,
        from: item.fromAddress,
        reason: item.triage.reason,
      })),
    });
  }

  const events: NormalizedEvent[] = [];
  for (const item of maybeReal.slice(0, 25)) {
    const message = item.message;
    let bodyText = "";
    try {
      const full = await graphRequest<{
        body?: { contentType?: string; content?: string };
      }>(
        userPath(
          `/messages/${encodeURIComponent(message.id)}?$select=body`,
        ),
      );
      bodyText =
        full.body?.contentType?.toLowerCase() === "html"
          ? htmlToText(full.body.content || "")
          : (full.body?.content || "").trim();
    } catch (error) {
      logger.warn("connector_microsoft_body_fetch_failed", {
        messageId: message.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    const actor =
      message.from?.emailAddress?.name ||
      message.from?.emailAddress?.address ||
      "Unknown sender";
    const summary = (bodyText || message.bodyPreview || "").slice(0, 2500);
    const type = message.isRead === false ? "NewEmail" : "EmailThreadUpdated";

    events.push({
      eventId: `microsoft365:email:${message.id}`,
      type: type as NormalizedEvent["type"],
      occurredAt: message.receivedDateTime || new Date().toISOString(),
      title: message.subject || "(no subject)",
      summary,
      actor,
      connector: "microsoft365",
      payload: {
        messageId: message.id,
        conversationId: message.conversationId,
        fromAddress: message.from?.emailAddress?.address,
        isRead: message.isRead,
        importance: message.importance,
        triageReason: item.triage.reason,
        accountLabel: "work",
        accountEmail: config?.userEmail,
      },
    });
  }

  return events;
}

async function emitCalendar(): Promise<NormalizedEvent[]> {
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $top: "50",
    $orderby: "start/dateTime",
    $select:
      "id,subject,start,end,location,organizer,isCancelled,responseStatus,bodyPreview,showAs,type",
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
      showAs?: string;
      type?: string;
    }>;
  }>(userPath(`/calendarView?${params}`));

  return (data.value || []).map((event) => {
    const organizerAddress = event.organizer?.emailAddress?.address;
    const actor =
      event.organizer?.emailAddress?.name ||
      organizerAddress ||
      "Calendar";
    const response = event.responseStatus?.response || "none";
    const isInvite =
      response === "notResponded" ||
      response === "none" ||
      response === "tentativelyAccepted";

    const summary = [
      `Organizer: ${actor}${organizerAddress ? ` <${organizerAddress}>` : ""}`,
      `Start: ${event.start?.dateTime || "unknown"} (${event.start?.timeZone || ""})`,
      `End: ${event.end?.dateTime || "unknown"}`,
      `Location: ${event.location?.displayName || "n/a"}`,
      `Response status: ${response}`,
      `Cancelled: ${Boolean(event.isCancelled)}`,
      event.bodyPreview || "",
    ].join("\n");

    return {
      eventId: `microsoft365:calendar:${event.id}`,
      type: (isInvite ? "MeetingInvitation" : "CalendarChanged") as NormalizedEvent["type"],
      occurredAt: event.start?.dateTime || new Date().toISOString(),
      title: event.subject || "(no subject)",
      summary: summary.slice(0, 2500),
      actor,
      connector: "microsoft365",
      payload: {
        eventId: event.id,
        startDateTime: event.start?.dateTime,
        endDateTime: event.end?.dateTime,
        timeZone: event.start?.timeZone,
        responseStatus: response,
        isCancelled: event.isCancelled,
        showAs: event.showAs,
        organizerAddress,
        fromAddress: organizerAddress,
      },
    };
  });
}

async function emitTodos(): Promise<NormalizedEvent[]> {
  const lists = await graphRequest<{
    value?: Array<{ id: string; displayName?: string }>;
  }>(userPath("/todo/lists"));

  const events: NormalizedEvent[] = [];
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
      events.push({
        eventId: `microsoft365:todo:${list.id}:${task.id}`,
        type: "ReminderDue",
        occurredAt:
          task.dueDateTime?.dateTime ||
          task.createdDateTime ||
          new Date().toISOString(),
        title: task.title || "(untitled task)",
        summary: [
          `List: ${list.displayName || "To Do"}`,
          `Importance: ${task.importance || "normal"}`,
          `Due: ${task.dueDateTime?.dateTime || "none"}`,
          task.body?.content || "",
        ]
          .join("\n")
          .slice(0, 2500),
        actor: list.displayName || "To Do",
        projectHint: list.displayName,
        connector: "microsoft365",
        payload: {
          listId: list.id,
          taskId: task.id,
          dueDateTime: task.dueDateTime?.dateTime,
          importance: task.importance,
          status: task.status,
        },
      });
    }
  }
  return events;
}

export const microsoftConnector: Connector = {
  id: "microsoft365",
  async collect() {
    if (!getMicrosoftConfig()) return [];

    const results = await Promise.allSettled([
      emitMail(),
      emitCalendar(),
      emitTodos(),
    ]);
    const events: NormalizedEvent[] = [];
    const labels = ["mail", "calendar", "todo"] as const;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") events.push(...result.value);
      else {
        logger.warn("connector_microsoft_partial_failure", {
          part: labels[index],
          error:
            result.reason instanceof Error ? result.reason.message : "unknown",
        });
      }
    });
    return events;
  },
};
