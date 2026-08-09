import {
  createAttentionBlock,
  deleteAttentionBlock,
  listAttentionBlocks,
  partitionByAttentionBlocks,
} from "@/lib/attention/blocks";
import { getDefaultTimeZone } from "@/lib/env";
import { GoogleApiError } from "@/lib/google/auth";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleCalendarEvent,
  listGoogleCalendarEvents,
  respondGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  type GoogleCalendarEvent,
} from "@/lib/google/calendar";
import { getGoogleConfig, isGoogleConfigured } from "@/lib/google/config";
import {
  createGmailDraft,
  createGmailReplyDraft,
  extractGmailTextBody,
  getGmailMessage,
  listGmailLabels,
  listGmailMessageIds,
  markGmailRead,
  resolveGmailMessageId,
  sendGmailMessage,
  summarizeGmailHeaders,
} from "@/lib/google/gmail";
import { partitionMailByTriage } from "@/lib/mail/triage";
import { getMicrosoftConfig, isMicrosoftConfigured } from "@/lib/microsoft/config";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data }, null, 0);
}

function fail(error: unknown) {
  if (error instanceof GoogleApiError) {
    return JSON.stringify({
      ok: false,
      error: error.message,
      status: error.status,
      details: error.details.slice(0, 500),
    });
  }
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Unknown Google API error",
  });
}

function requireGoogle() {
  const config = getGoogleConfig();
  if (!config) throw new Error("Google is not configured.");
  return config;
}

async function listMailAccounts() {
  const accounts = [];
  if (isMicrosoftConfigured()) {
    const ms = getMicrosoftConfig()!;
    accounts.push({
      id: "microsoft365",
      provider: "microsoft365",
      label: "work",
      email: ms.userEmail,
      capabilities: ["mail", "calendar"],
      note: "Use brief_inbox / list_calendar_events (Outlook tools, unprefixed).",
    });
  }
  if (isGoogleConfigured()) {
    const g = getGoogleConfig()!;
    accounts.push({
      id: "google",
      provider: "google",
      label: g.label,
      email: g.userEmail,
      capabilities: ["mail", "calendar"],
      note: "Use gmail_* and google_* calendar tools for personal Google.",
    });
  }
  return ok({
    count: accounts.length,
    accounts,
    guidance:
      "Always name which account you used (Work/Outlook vs Personal/Gmail). Never mix results.",
  });
}

async function gmailBriefInbox(args: {
  top?: number;
  autoClearNoise?: boolean;
  query?: string;
}) {
  const config = requireGoogle();
  const top = Math.min(Math.max(args.top ?? 8, 1), 12);
  const autoClearNoise = args.autoClearNoise ?? true;
  const headerBudget = Math.min(Math.max(top * 3, 24), 50);
  const qParts = ["is:unread", "-in:spam", "-in:trash"];
  if (args.query?.trim()) qParts.push(args.query.trim());

  const listed = await listGmailMessageIds({
    q: qParts.join(" "),
    maxResults: headerBudget,
  });
  const ids = listed.messages || [];

  const headers = [];
  const errors: string[] = [];
  for (const item of ids) {
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
        message,
      });
    } catch (error) {
      errors.push(
        `${item.id}: ${error instanceof Error ? error.message : "metadata failed"}`,
      );
    }
  }

  const blocks = await listAttentionBlocks();
  const { blocked, allowed } = partitionByAttentionBlocks(headers, blocks);

  const { noise, maybeReal } = partitionMailByTriage(allowed);

  const toClear = [
    ...blocked.map((b) => ({
      id: b.id,
      subject: b.subject || "(no subject)",
      from: b.fromAddress || b.fromName || null,
      reason: b.blockReason,
    })),
    ...noise.map((n) => ({
      id: n.id,
      subject: n.subject || "(no subject)",
      from: n.fromAddress || n.fromName || null,
      reason: n.triage.reason,
    })),
  ];

  let markedRead = 0;
  if (autoClearNoise) {
    for (const item of toClear) {
      try {
        await markGmailRead(item.id, true);
        markedRead += 1;
      } catch {
        // continue
      }
    }
  }

  const emails = [];
  let index = 0;
  for (const item of maybeReal.slice(0, top)) {
    try {
      const full = await getGmailMessage(item.id, "full");
      const textBody = extractGmailTextBody(full).slice(0, 12_000);
      const summary = summarizeGmailHeaders(full);
      index += 1;
      emails.push({
        index,
        id: summary.id,
        account: "google",
        accountLabel: config.label,
        accountEmail: config.userEmail,
        subject: summary.subject,
        from: {
          name: summary.fromName,
          address: summary.fromAddress,
        },
        receivedDateTime: summary.internalDate,
        labelIds: summary.labelIds,
        textBody,
        textBodyTruncated: textBody.length >= 12_000,
        triageReason: item.triage.reason,
      });
    } catch (error) {
      errors.push(
        `${item.id}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }

  return ok({
    account: "google",
    accountLabel: config.label,
    accountEmail: config.userEmail,
    count: emails.length,
    emails,
    autoCleared: toClear.map((item) => ({
      ...item,
      markedRead: autoClearNoise,
    })),
    autoClearedCount: toClear.length,
    autoClearedMarkedRead: markedRead,
    blockedCount: blocked.length,
    skippedUnreadReal: Math.max(0, maybeReal.length - top),
    errors,
    guidance:
      "PERSONAL Gmail. Number results as #1..#N using emails[].index. For 'block #1': call block_attention_sender with emails[0].from.address, then gmail_mark_read with the FULL emails[0].id. For 'show #2': gmail_get_email with the FULL emails[1].id. Never invent or truncate ids. Mention autoCleared only briefly.",
  });
}

async function gmailListMessages(args: { query?: string; maxResults?: number }) {
  const config = requireGoogle();
  const listed = await listGmailMessageIds({
    q: args.query || "in:inbox -in:spam -in:trash",
    maxResults: args.maxResults ?? 20,
  });
  const items = [];
  for (const m of listed.messages || []) {
    const message = await getGmailMessage(m.id, "metadata");
    const summary = summarizeGmailHeaders(message);
    items.push({
      id: summary.id,
      account: "google",
      accountEmail: config.userEmail,
      subject: summary.subject,
      from: summary.fromAddress,
      fromName: summary.fromName,
      snippet: summary.snippet,
      labelIds: summary.labelIds,
      receivedDateTime: summary.internalDate,
    });
  }
  return ok({ count: items.length, messages: items });
}

async function gmailGetEmail(args: { messageId: string }) {
  const config = requireGoogle();
  const messageId = await resolveGmailMessageId(String(args.messageId || ""));
  const full = await getGmailMessage(messageId, "full");
  const summary = summarizeGmailHeaders(full);
  const textBody = extractGmailTextBody(full).slice(0, 50_000);
  return ok({
    account: "google",
    accountLabel: config.label,
    accountEmail: config.userEmail,
    id: summary.id,
    threadId: summary.threadId,
    subject: summary.subject,
    from: { name: summary.fromName, address: summary.fromAddress },
    to: summary.to,
    cc: summary.cc,
    receivedDateTime: summary.internalDate,
    labelIds: summary.labelIds,
    textBody,
    textBodyTruncated: textBody.length >= 50_000,
  });
}

function formatCalendarEvent(event: GoogleCalendarEvent) {
  const self = event.attendees?.find((a) => a.self);
  return {
    id: event.id,
    account: "google",
    summary: event.summary || "(no title)",
    description: event.description || null,
    location: event.location || null,
    status: event.status || null,
    htmlLink: event.htmlLink || null,
    start: event.start || null,
    end: event.end || null,
    organizer: event.organizer || null,
    responseStatus: self?.responseStatus || null,
    attendees: (event.attendees || []).map((a) => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      self: Boolean(a.self),
    })),
  };
}

type GoogleToolHandler = (args: Record<string, unknown>) => Promise<string>;

export const googleToolHandlers: Record<string, GoogleToolHandler> = {
  list_mail_accounts: async () => listMailAccounts(),
  block_attention_sender: async (args) => {
    const block = await createAttentionBlock({
      target: String(args.target || ""),
      reason: typeof args.reason === "string" ? args.reason : null,
      source: "tool",
    });
    return ok({
      blocked: block,
      note: "Future Attention scans will skip this sender/domain on both Work and Personal mail. Mail is not deleted.",
    });
  },
  unblock_attention_sender: async (args) => {
    const removed = await deleteAttentionBlock(String(args.target || ""));
    return ok({ removed, target: args.target });
  },
  list_attention_blocks: async () => {
    const blocks = await listAttentionBlocks();
    return ok({ count: blocks.length, blocks });
  },
  gmail_brief_inbox: async (args) =>
    gmailBriefInbox(
      args as { top?: number; autoClearNoise?: boolean; query?: string },
    ),
  gmail_list_messages: async (args) =>
    gmailListMessages(args as { query?: string; maxResults?: number }),
  gmail_get_email: async (args) =>
    gmailGetEmail(args as { messageId: string }),
  gmail_mark_read: async (args) => {
    requireGoogle();
    const messageId = await resolveGmailMessageId(String(args.messageId || ""));
    await markGmailRead(
      messageId,
      args.isRead === undefined ? true : Boolean(args.isRead),
    );
    return ok({
      messageId,
      requestedId: args.messageId,
      isRead: args.isRead ?? true,
    });
  },
  gmail_send_email: async (args) => {
    requireGoogle();
    const sent = await sendGmailMessage({
      to: String(args.to),
      subject: String(args.subject),
      body: String(args.body),
    });
    return ok({ sent, account: "google" });
  },
  gmail_create_draft: async (args) => {
    requireGoogle();
    const draft = await createGmailDraft({
      to: String(args.to),
      subject: String(args.subject),
      body: String(args.body),
    });
    return ok({ draft, account: "google" });
  },
  gmail_create_reply_draft: async (args) => {
    requireGoogle();
    const draft = await createGmailReplyDraft({
      messageId: String(args.messageId),
      body: String(args.body),
      subject: typeof args.subject === "string" ? args.subject : undefined,
    });
    return ok({ draft, account: "google" });
  },
  gmail_list_labels: async () => {
    requireGoogle();
    const data = await listGmailLabels();
    return ok({ labels: data.labels || [] });
  },
  google_list_calendar_events: async (args) => {
    const config = requireGoogle();
    const timeMin =
      typeof args.timeMin === "string"
        ? args.timeMin
        : new Date().toISOString();
    const timeMax =
      typeof args.timeMax === "string"
        ? args.timeMax
        : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const data = await listGoogleCalendarEvents({
      timeMin,
      timeMax,
      maxResults:
        typeof args.maxResults === "number" ? args.maxResults : undefined,
      q: typeof args.q === "string" ? args.q : undefined,
    });
    const items = (data.items || []).map(formatCalendarEvent);
    return ok({
      account: "google",
      accountLabel: config.label,
      accountEmail: config.userEmail,
      timeZone: getDefaultTimeZone(),
      count: items.length,
      items,
      note: "PERSONAL Google Calendar. Do not mix with Outlook list_calendar_events.",
    });
  },
  google_get_calendar_event: async (args) => {
    requireGoogle();
    const event = await getGoogleCalendarEvent(String(args.eventId));
    return ok(formatCalendarEvent(event));
  },
  google_create_calendar_event: async (args) => {
    requireGoogle();
    const event = await createGoogleCalendarEvent({
      summary: String(args.summary),
      description:
        typeof args.description === "string" ? args.description : undefined,
      location: typeof args.location === "string" ? args.location : undefined,
      start: String(args.start),
      end: String(args.end),
      attendees: Array.isArray(args.attendees)
        ? args.attendees.map(String)
        : undefined,
    });
    return ok(formatCalendarEvent(event));
  },
  google_update_calendar_event: async (args) => {
    requireGoogle();
    const event = await updateGoogleCalendarEvent(String(args.eventId), {
      summary: typeof args.summary === "string" ? args.summary : undefined,
      description:
        typeof args.description === "string" ? args.description : undefined,
      location: typeof args.location === "string" ? args.location : undefined,
      start: typeof args.start === "string" ? args.start : undefined,
      end: typeof args.end === "string" ? args.end : undefined,
    });
    return ok(formatCalendarEvent(event));
  },
  google_delete_calendar_event: async (args) => {
    requireGoogle();
    await deleteGoogleCalendarEvent(String(args.eventId));
    return ok({ deleted: true, eventId: args.eventId });
  },
  google_respond_calendar_event: async (args) => {
    requireGoogle();
    const response = String(args.response) as
      | "accepted"
      | "declined"
      | "tentative";
    const event = await respondGoogleCalendarEvent(
      String(args.eventId),
      response,
    );
    return ok(formatCalendarEvent(event));
  },
};

export function listGoogleToolNames() {
  return Object.keys(googleToolHandlers).filter((name) => {
    if (
      name === "list_mail_accounts" ||
      name === "block_attention_sender" ||
      name === "unblock_attention_sender" ||
      name === "list_attention_blocks"
    ) {
      return isMicrosoftConfigured() || isGoogleConfigured();
    }
    return isGoogleConfigured();
  });
}

export async function executeGoogleTool(name: string, argsJson: string) {
  const handler = googleToolHandlers[name];
  if (!handler) {
    return JSON.stringify({ ok: false, error: `Unknown Google tool: ${name}` });
  }
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ ok: false, error: "Invalid tool arguments JSON." });
  }
  try {
    return await handler(args);
  } catch (error) {
    return fail(error);
  }
}
