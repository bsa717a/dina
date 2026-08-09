import type { NormalizedEvent } from "@/lib/chief-of-staff/types";
import type { Connector } from "@/lib/connectors/types";
import {
  listAttentionBlocks,
  partitionByAttentionBlocks,
} from "@/lib/attention/blocks";
import { getGoogleConfig } from "@/lib/google/config";
import {
  listGoogleCalendarEvents,
  type GoogleCalendarEvent,
} from "@/lib/google/calendar";
import {
  extractGmailTextBody,
  getGmailMessage,
  listGmailMessageIds,
  markGmailRead,
  summarizeGmailHeaders,
} from "@/lib/google/gmail";
import { partitionMailByTriage } from "@/lib/mail/triage";
import { logger } from "@/lib/logger";

async function markMessagesRead(ids: string[]) {
  let success = 0;
  for (const id of ids) {
    try {
      await markGmailRead(id, true);
      success += 1;
    } catch (error) {
      logger.warn("connector_google_mark_read_failed", {
        messageId: id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return success;
}

async function emitMail(): Promise<NormalizedEvent[]> {
  const config = getGoogleConfig();
  if (!config) return [];

  const after = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
  const listed = await listGmailMessageIds({
    q: `is:unread -in:spam -in:trash after:${after}`,
    maxResults: 40,
  });

  const headers = [];
  for (const item of listed.messages || []) {
    try {
      const message = await getGmailMessage(item.id, "metadata");
      const summary = summarizeGmailHeaders(message);
      headers.push({
        id: summary.id,
        subject: summary.subject,
        fromAddress: summary.fromAddress,
        fromName: summary.fromName,
        bodyPreview: summary.snippet,
        labelIds: summary.labelIds,
        listUnsubscribe: summary.listUnsubscribe,
        internalDate: summary.internalDate,
        threadId: summary.threadId,
      });
    } catch (error) {
      logger.warn("connector_google_metadata_fetch_failed", {
        messageId: item.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const blocks = await listAttentionBlocks();
  const { blocked, allowed } = partitionByAttentionBlocks(headers, blocks);

  if (blocked.length) {
    const marked = await markMessagesRead(blocked.map((b) => b.id));
    logger.info("connector_google_blocked_cleared", {
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
    logger.info("connector_google_noise_cleared", {
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
    let bodyText = item.bodyPreview || "";
    try {
      const full = await getGmailMessage(item.id, "full");
      bodyText = extractGmailTextBody(full) || bodyText;
    } catch (error) {
      logger.warn("connector_google_body_fetch_failed", {
        messageId: item.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }

    const actor = item.fromName || item.fromAddress || "Unknown sender";
    events.push({
      eventId: `google:email:${item.id}`,
      type: "NewEmail",
      occurredAt: item.internalDate || new Date().toISOString(),
      title: item.subject || "(no subject)",
      summary: bodyText.slice(0, 2500),
      actor,
      connector: "google",
      payload: {
        messageId: item.id,
        threadId: item.threadId,
        fromAddress: item.fromAddress,
        accountLabel: config.label,
        accountEmail: config.userEmail,
        triageReason: item.triage.reason,
      },
    });
  }

  return events;
}

function selfResponse(event: GoogleCalendarEvent): string {
  const self = event.attendees?.find((a) => a.self);
  if (self?.responseStatus) return self.responseStatus;
  // Own/organizer events often have no self attendee — not unanswered invites.
  if (event.organizer?.self) return "accepted";
  // External invite (with or without attendee payload) still needs a response.
  return "needsAction";
}

async function emitCalendar(): Promise<NormalizedEvent[]> {
  const config = getGoogleConfig();
  if (!config) return [];

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const data = await listGoogleCalendarEvents({
    timeMin,
    timeMax,
    maxResults: 50,
  });

  return (data.items || []).map((event) => {
    const organizerAddress = event.organizer?.email || null;
    const actor =
      event.organizer?.displayName || organizerAddress || "Calendar";
    const response = selfResponse(event);
    const isInvite =
      !event.organizer?.self &&
      (response === "needsAction" || response === "tentative");

    const summary = [
      `Account: Personal Google (${config.userEmail})`,
      `Organizer: ${actor}${organizerAddress ? ` <${organizerAddress}>` : ""}`,
      `Start: ${event.start?.dateTime || event.start?.date || "unknown"}`,
      `End: ${event.end?.dateTime || event.end?.date || "unknown"}`,
      `Location: ${event.location || "n/a"}`,
      `Response status: ${response}`,
      `Status: ${event.status || "confirmed"}`,
      event.description || "",
    ].join("\n");

    return {
      eventId: `google:calendar:${event.id}`,
      type: (isInvite ? "MeetingInvitation" : "CalendarChanged") as NormalizedEvent["type"],
      occurredAt:
        event.start?.dateTime ||
        (event.start?.date
          ? `${event.start.date}T00:00:00.000Z`
          : new Date().toISOString()),
      title: event.summary || "(no subject)",
      summary: summary.slice(0, 2500),
      actor,
      connector: "google",
      payload: {
        eventId: event.id,
        organizerAddress,
        responseStatus: response,
        accountLabel: config.label,
        accountEmail: config.userEmail,
        htmlLink: event.htmlLink,
      },
    };
  });
}

export const googleConnector: Connector = {
  id: "google",
  async collect() {
    if (!getGoogleConfig()) return [];
    const [mail, calendar] = await Promise.all([emitMail(), emitCalendar()]);
    return [...mail, ...calendar];
  },
};
