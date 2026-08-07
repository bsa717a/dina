import { getMicrosoftConfig } from "@/lib/microsoft/config";
import { GraphError, graphRequest, userPath } from "@/lib/microsoft/graph";
import { partitionMailByTriage } from "@/lib/microsoft/mail-triage";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data }, null, 0);
}

function fail(error: unknown) {
  if (error instanceof GraphError) {
    return JSON.stringify({
      ok: false,
      error: error.message,
      status: error.status,
      details: error.details.slice(0, 500),
    });
  }
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Unknown Microsoft Graph error",
  });
}

function requireConfig() {
  const config = getMicrosoftConfig();
  if (!config) throw new Error("Microsoft 365 is not configured.");
  return config;
}

function encodePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function stripHtml(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#58;/gi, ":")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Mail ────────────────────────────────────────────────────────────────────

type GraphMessage = {
  id: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  bodyPreview?: string;
  hasAttachments?: boolean;
  importance?: string;
  inferenceClassification?: string;
};

async function fetchMessagesPage(args: {
  unreadOnly?: boolean;
  top?: number;
  search?: string;
  maxPages?: number;
  maxItems?: number;
}) {
  const pageSize = Math.min(Math.max(args.top ?? 50, 1), 100);
  const maxItems = Math.min(Math.max(args.maxItems ?? pageSize, 1), 500);
  const maxPages = Math.min(Math.max(args.maxPages ?? 10, 1), 20);
  const select =
    "id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments,importance,inferenceClassification";
  const params = new URLSearchParams({
    $top: String(pageSize),
    $select: select,
  });

  const search = args.search?.trim();
  // $search cannot be combined with $orderby in Graph.
  if (search) {
    params.set("$search", `"${search.replace(/"/g, "")}"`);
  } else {
    params.set("$orderby", "receivedDateTime desc");
    if (args.unreadOnly) params.set("$filter", "isRead eq false");
  }

  const folder = search ? "messages" : "mailFolders/inbox/messages";
  let nextUrl: string | undefined = userPath(`/${folder}?${params}`);
  const messages: GraphMessage[] = [];
  let pages = 0;

  while (nextUrl && pages < maxPages && messages.length < maxItems) {
    const pageUrl = nextUrl;
    const data: {
      value?: GraphMessage[];
      "@odata.nextLink"?: string;
    } = await graphRequest(pageUrl, {
      headers: search ? { ConsistencyLevel: "eventual" } : undefined,
    });
    pages += 1;
    for (const message of data.value ?? []) {
      if (args.unreadOnly && search && message.isRead) continue;
      messages.push(message);
      if (messages.length >= maxItems) break;
    }
    nextUrl = data["@odata.nextLink"];
  }

  return {
    count: messages.length,
    messages,
    hasMore: Boolean(nextUrl) || messages.length >= maxItems,
    pages,
  };
}

function messageMatches(
  message: GraphMessage,
  args: { fromContains?: string; subjectContains?: string },
) {
  const from = (
    message.from?.emailAddress?.address ||
    message.from?.emailAddress?.name ||
    ""
  ).toLowerCase();
  const subject = (message.subject || "").toLowerCase();
  if (args.fromContains && !from.includes(args.fromContains.toLowerCase())) {
    return false;
  }
  if (args.subjectContains && !subject.includes(args.subjectContains.toLowerCase())) {
    return false;
  }
  return true;
}

async function listInboxMessages(args: {
  unreadOnly?: boolean;
  top?: number;
  search?: string;
  maxItems?: number;
}) {
  const result = await fetchMessagesPage({
    unreadOnly: args.unreadOnly,
    top: args.top ?? 50,
    search: args.search,
    maxItems: args.maxItems ?? args.top ?? 50,
    maxPages: 10,
  });
  return ok(result);
}

async function markMatchingEmailsRead(args: {
  unreadOnly?: boolean;
  fromContains?: string;
  subjectContains?: string;
  search?: string;
  max?: number;
}) {
  const max = Math.min(Math.max(args.max ?? 200, 1), 500);
  const unreadOnly = args.unreadOnly ?? true;
  const page = await fetchMessagesPage({
    unreadOnly,
    search: args.search,
    top: 50,
    maxItems: max,
    maxPages: 20,
  });

  const matches = page.messages.filter((message) =>
    messageMatches(message, {
      fromContains: args.fromContains,
      subjectContains: args.subjectContains,
    }),
  );

  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  const markedSubjects: string[] = [];

  for (const message of matches) {
    try {
      await graphRequest(userPath(`/messages/${encodeURIComponent(message.id)}`), {
        method: "PATCH",
        body: { isRead: true },
      });
      success += 1;
      if (markedSubjects.length < 10) {
        markedSubjects.push(message.subject || "(no subject)");
      }
    } catch (error) {
      failed += 1;
      if (errors.length < 5) {
        errors.push(error instanceof Error ? error.message : "failed");
      }
    }
  }

  return ok({
    matched: matches.length,
    scanned: page.count,
    success,
    failed,
    hasMore: page.hasMore,
    sampleSubjects: markedSubjects,
    errors,
  });
}

function isNoisyUrl(url: string) {
  return (
    /outlook\.office(365)?\.com\/owa/i.test(url) ||
    /sendgrid\.net/i.test(url) ||
    /ct\.sendgrid\.net/i.test(url) ||
    /click\./i.test(url) ||
    /\/ls\/click/i.test(url) ||
    /list-manage\.com/i.test(url) ||
    /mailchi\.mp/i.test(url) ||
    /mandrillapp\.com/i.test(url) ||
    /track\./i.test(url) ||
    /email\..*\/c\//i.test(url)
  );
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const text = String(label).replace(/<[^>]+>/g, "").trim() || "link";
      // Keep readable CTA text; drop noisy tracking/dashboard URLs from digests.
      if (isNoisyUrl(String(href))) return text;
      return text;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/https?:\/\/[^\s)<>"']+/g, (url) => (isNoisyUrl(url) ? "" : url))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function summarizeEmailPayload(data: {
  id?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: unknown;
  ccRecipients?: unknown;
  receivedDateTime?: string;
  isRead?: boolean;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  hasAttachments?: boolean;
  importance?: string;
}) {
  const raw = data.body?.content || "";
  const contentType = data.body?.contentType || "Text";
  const textBody =
    contentType.toLowerCase() === "html" ? htmlToText(raw) : raw.trim();
  const clipped = textBody.slice(0, 12_000);
  return {
    id: data.id,
    subject: data.subject,
    from: data.from?.emailAddress || null,
    toRecipients: data.toRecipients,
    ccRecipients: data.ccRecipients,
    receivedDateTime: data.receivedDateTime,
    isRead: data.isRead,
    importance: data.importance,
    hasAttachments: data.hasAttachments,
    bodyPreview: data.bodyPreview,
    textBody: clipped,
    textBodyTruncated: textBody.length > clipped.length,
  };
}

async function getEmail(args: { messageId: string }) {
  const data = await graphRequest<{
    id?: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    toRecipients?: unknown;
    ccRecipients?: unknown;
    receivedDateTime?: string;
    isRead?: boolean;
    body?: { contentType?: string; content?: string };
    bodyPreview?: string;
    hasAttachments?: boolean;
    importance?: string;
  }>(
    userPath(
      `/messages/${encodeURIComponent(args.messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,body,bodyPreview,hasAttachments,importance`,
    ),
  );
  return ok(summarizeEmailPayload(data));
}

async function fetchEmailById(messageId: string) {
  return graphRequest<{
    id?: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    toRecipients?: unknown;
    ccRecipients?: unknown;
    receivedDateTime?: string;
    isRead?: boolean;
    body?: { contentType?: string; content?: string };
    bodyPreview?: string;
    hasAttachments?: boolean;
    importance?: string;
  }>(
    userPath(
      `/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,body,bodyPreview,hasAttachments,importance`,
    ),
  );
}

async function getEmails(args: { messageIds: string[] }) {
  const ids = (args.messageIds || []).slice(0, 15);
  const emails = [];
  const errors: string[] = [];
  for (const messageId of ids) {
    try {
      emails.push(summarizeEmailPayload(await fetchEmailById(messageId)));
    } catch (error) {
      errors.push(
        `${messageId}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }
  return ok({ count: emails.length, emails, errors });
}

async function markMessageIdsRead(messageIds: string[]) {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const id of messageIds.slice(0, 200)) {
    try {
      await graphRequest(userPath(`/messages/${encodeURIComponent(id)}`), {
        method: "PATCH",
        body: { isRead: true },
      });
      success += 1;
    } catch (error) {
      failed += 1;
      errors.push(
        `${id}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }
  return { success, failed, errors };
}

/** One-shot inbox briefing with bodies — preferred for digests/summaries. */
async function briefInbox(args: {
  unreadOnly?: boolean;
  top?: number;
  search?: string;
  autoClearNoise?: boolean;
}) {
  const top = Math.min(Math.max(args.top ?? 8, 1), 12);
  const autoClearNoise = args.autoClearNoise ?? true;
  // Over-fetch headers so noise can be cleared without starving real mail.
  const headerBudget = Math.min(Math.max(top * 3, 24), 50);
  const page = await fetchMessagesPage({
    unreadOnly: args.unreadOnly ?? true,
    search: args.search,
    top: headerBudget,
    maxItems: headerBudget,
    maxPages: 1,
  });

  const { noise, maybeReal } = partitionMailByTriage(
    page.messages.map((message) => ({
      id: message.id,
      subject: message.subject,
      fromAddress: message.from?.emailAddress?.address,
      fromName: message.from?.emailAddress?.name,
      bodyPreview: message.bodyPreview,
      inferenceClassification: message.inferenceClassification,
      message,
    })),
  );

  let cleared = { success: 0, failed: 0, errors: [] as string[] };
  if (autoClearNoise && noise.length) {
    cleared = await markMessageIdsRead(
      noise.map((item) => item.id).filter((id): id is string => Boolean(id)),
    );
  }

  const toRead = maybeReal.slice(0, top);
  const emails = [];
  const errors: string[] = [...cleared.errors];
  for (const item of toRead) {
    const message = item.message;
    try {
      emails.push(summarizeEmailPayload(await fetchEmailById(message.id)));
    } catch (error) {
      errors.push(
        `${message.id}: ${error instanceof Error ? error.message : "failed"}`,
      );
      emails.push({
        id: message.id,
        subject: message.subject,
        from: message.from?.emailAddress || null,
        receivedDateTime: message.receivedDateTime,
        isRead: message.isRead,
        bodyPreview: message.bodyPreview,
        textBody: message.bodyPreview || "",
        textBodyTruncated: false,
        bodyFetchFailed: true,
      });
    }
  }

  return ok({
    count: emails.length,
    hasMore: page.hasMore || maybeReal.length > top,
    emails,
    autoCleared: noise.map((item) => ({
      id: item.id,
      subject: item.subject || "(no subject)",
      from: item.fromAddress || item.fromName || null,
      reason: item.triage.reason,
      markedRead: autoClearNoise,
    })),
    autoClearedCount: noise.length,
    autoClearedMarkedRead: cleared.success,
    skippedUnreadReal: Math.max(0, maybeReal.length - top),
    errors,
    guidance:
      "Brief Derek from textBody only for emails[]. Mention autoCleared marketing/spam only briefly (count + a few subjects). Do not include Links sections, tracking URLs, SendGrid click wrappers, or Outlook/OWA links. Patterns in autoCleared are good unsubscribe candidates later.",
  });
}

async function markEmailRead(args: { messageId: string; isRead?: boolean }) {
  const data = await graphRequest(
    userPath(`/messages/${encodeURIComponent(args.messageId)}`),
    { method: "PATCH", body: { isRead: args.isRead ?? true } },
  );
  return ok(data);
}

async function markEmailsRead(args: { messageIds: string[] }) {
  const { success, failed, errors } = await markMessageIdsRead(
    args.messageIds || [],
  );
  return ok({ success, failed, errors: errors.slice(0, 5) });
}

// ─── Inbox rules ─────────────────────────────────────────────────────────────

async function listInboxRules() {
  const data = await graphRequest<{ value: unknown[] }>(
    userPath("/mailFolders/inbox/messageRules"),
  );
  return ok({ rules: data.value ?? [] });
}

async function createInboxRule(args: {
  displayName: string;
  sequence?: number;
  isEnabled?: boolean;
  senderContains?: string[];
  subjectContains?: string[];
  bodyContains?: string[];
  fromAddresses?: string[];
  markAsRead?: boolean;
  delete?: boolean;
  moveToFolder?: string;
  forwardTo?: string[];
  stopProcessingRules?: boolean;
}) {
  const existing = await graphRequest<{ value?: Array<{ sequence?: number }> }>(
    userPath("/mailFolders/inbox/messageRules"),
  );
  const maxSequence = (existing.value || []).reduce(
    (max, rule) => Math.max(max, rule.sequence || 0),
    0,
  );

  const conditions: Record<string, unknown> = {};
  if (args.senderContains?.length) conditions.senderContains = args.senderContains;
  if (args.subjectContains?.length) conditions.subjectContains = args.subjectContains;
  if (args.bodyContains?.length) conditions.bodyContains = args.bodyContains;
  if (args.fromAddresses?.length) {
    conditions.fromAddresses = args.fromAddresses.map((address) => ({
      emailAddress: { address },
    }));
  }

  if (!Object.keys(conditions).length) {
    throw new Error(
      "Provide at least one condition: senderContains, subjectContains, bodyContains, or fromAddresses.",
    );
  }

  const actions: Record<string, unknown> = {};
  if (args.markAsRead) actions.markAsRead = true;
  if (args.delete) actions.delete = true;
  if (args.moveToFolder) actions.moveToFolder = args.moveToFolder;
  if (args.forwardTo?.length) {
    actions.forwardTo = args.forwardTo.map((address) => ({
      emailAddress: { address },
    }));
  }
  if (args.stopProcessingRules) actions.stopProcessingRules = true;

  if (!Object.keys(actions).length) {
    throw new Error(
      "Provide at least one action: markAsRead, delete, moveToFolder, or forwardTo.",
    );
  }

  const data = await graphRequest(userPath("/mailFolders/inbox/messageRules"), {
    method: "POST",
    body: {
      displayName: args.displayName,
      sequence: args.sequence ?? maxSequence + 1,
      isEnabled: args.isEnabled ?? true,
      conditions,
      actions,
    },
  });
  return ok(data);
}

async function updateInboxRule(args: {
  ruleId: string;
  displayName?: string;
  sequence?: number;
  isEnabled?: boolean;
  markAsRead?: boolean;
  delete?: boolean;
  stopProcessingRules?: boolean;
}) {
  const body: Record<string, unknown> = {};
  if (args.displayName !== undefined) body.displayName = args.displayName;
  if (args.sequence !== undefined) body.sequence = args.sequence;
  if (args.isEnabled !== undefined) body.isEnabled = args.isEnabled;

  const actions: Record<string, unknown> = {};
  if (args.markAsRead !== undefined) actions.markAsRead = args.markAsRead;
  if (args.delete !== undefined) actions.delete = args.delete;
  if (args.stopProcessingRules !== undefined) {
    actions.stopProcessingRules = args.stopProcessingRules;
  }
  if (Object.keys(actions).length) body.actions = actions;

  const data = await graphRequest(
    userPath(`/mailFolders/inbox/messageRules/${encodeURIComponent(args.ruleId)}`),
    { method: "PATCH", body },
  );
  return ok(data);
}

async function deleteInboxRule(args: { ruleId: string }) {
  await graphRequest(
    userPath(`/mailFolders/inbox/messageRules/${encodeURIComponent(args.ruleId)}`),
    { method: "DELETE" },
  );
  return ok({ deleted: true, ruleId: args.ruleId });
}

async function sendEmail(args: {
  to: string | string[];
  subject: string;
  body: string;
  contentType?: "Text" | "HTML";
  cc?: string | string[];
}) {
  const toList = (Array.isArray(args.to) ? args.to : [args.to]).filter(Boolean);
  const ccList = (Array.isArray(args.cc) ? args.cc : args.cc ? [args.cc] : []).filter(Boolean);
  await graphRequest(userPath("/sendMail"), {
    method: "POST",
    body: {
      message: {
        subject: args.subject,
        body: {
          contentType: args.contentType || "Text",
          content: args.body,
        },
        toRecipients: toList.map((address) => ({ emailAddress: { address } })),
        ccRecipients: ccList.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    },
  });
  return ok({ sent: true, to: toList, subject: args.subject });
}

async function createReplyDraft(args: { messageId: string; comment?: string }) {
  const data = await graphRequest(
    userPath(`/messages/${encodeURIComponent(args.messageId)}/createReply`),
    {
      method: "POST",
      body: args.comment ? { comment: args.comment } : {},
    },
  );
  return ok(data);
}

async function listMailFolders() {
  const data = await graphRequest<{ value: unknown[] }>(
    userPath("/mailFolders?$top=50&$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount"),
  );
  return ok({ folders: data.value ?? [] });
}

async function listChildMailFolders(args: { parentFolderId?: string }) {
  const parent = args.parentFolderId?.trim() || "inbox";
  const data = await graphRequest<{ value: Array<{ id: string; displayName?: string }> }>(
    userPath(
      `/mailFolders/${encodeURIComponent(parent)}/childFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount,childFolderCount`,
    ),
  );
  return ok({ parentFolderId: parent, folders: data.value ?? [] });
}

async function createMailFolder(args: {
  displayName: string;
  parentFolderId?: string;
}) {
  const parent = args.parentFolderId?.trim() || "inbox";
  const data = await graphRequest(
    userPath(`/mailFolders/${encodeURIComponent(parent)}/childFolders`),
    {
      method: "POST",
      body: {
        displayName: args.displayName,
        isHidden: false,
      },
    },
  );
  return ok(data);
}

async function ensureMailFolder(args: {
  displayName: string;
  parentFolderId?: string;
}) {
  const parent = args.parentFolderId?.trim() || "inbox";
  const existing = await graphRequest<{
    value?: Array<{ id: string; displayName?: string }>;
  }>(
    userPath(
      `/mailFolders/${encodeURIComponent(parent)}/childFolders?$top=100&$select=id,displayName`,
    ),
  );
  const match = (existing.value || []).find(
    (folder) =>
      (folder.displayName || "").toLowerCase() === args.displayName.toLowerCase(),
  );
  if (match) {
    return ok({ created: false, folder: match });
  }

  const created = await graphRequest<{ id: string; displayName?: string }>(
    userPath(`/mailFolders/${encodeURIComponent(parent)}/childFolders`),
    {
      method: "POST",
      body: {
        displayName: args.displayName,
        isHidden: false,
      },
    },
  );
  return ok({ created: true, folder: created });
}

// ─── Calendar ────────────────────────────────────────────────────────────────

async function listCalendarEvents(args: {
  start?: string;
  end?: string;
  top?: number;
}) {
  const top = Math.min(Math.max(args.top ?? 50, 1), 100);
  const start = args.start || new Date().toISOString();
  const end =
    args.end ||
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $top: String(top),
    $orderby: "start/dateTime",
    $select:
      "id,subject,start,end,location,organizer,isAllDay,webLink,bodyPreview,attendees,showAs,responseStatus",
  });
  const data = await graphRequest<{
    value?: Array<{
      id?: string;
      subject?: string;
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
      location?: { displayName?: string };
      organizer?: { emailAddress?: { name?: string; address?: string } };
      isAllDay?: boolean;
      showAs?: string;
      responseStatus?: { response?: string };
      bodyPreview?: string;
      webLink?: string;
    }>;
  }>(userPath(`/calendarView?${params}`));

  const items = (data.value || []).map((event) => {
    const tz = event.start?.timeZone || "America/Denver";
    const startDt = event.start?.dateTime || "";
    const endDt = event.end?.dateTime || "";
    return {
      id: event.id,
      subject: event.subject,
      start: event.start,
      end: event.end,
      when: startDt
        ? `${startDt.slice(0, 16).replace("T", " ")}${endDt ? ` – ${endDt.slice(11, 16)}` : ""} (${tz})`
        : null,
      location: event.location?.displayName || null,
      organizer:
        event.organizer?.emailAddress?.name ||
        event.organizer?.emailAddress?.address ||
        null,
      organizerEmail: event.organizer?.emailAddress?.address || null,
      responseStatus: event.responseStatus?.response || null,
      showAs: event.showAs || null,
      isAllDay: Boolean(event.isAllDay),
      bodyPreview: event.bodyPreview || null,
      webLink: event.webLink || null,
    };
  });

  return ok({
    count: items.length,
    timeZone: "America/Denver",
    note: "Times are America/Denver wall-clock unless noted. Call this tool for any calendar question — do not guess from memory.",
    items,
  });
}

async function getCalendarEvent(args: { eventId: string }) {
  const data = await graphRequest(
    userPath(`/events/${encodeURIComponent(args.eventId)}`),
  );
  return ok(data);
}

async function createCalendarEvent(args: {
  subject: string;
  start: string;
  end: string;
  timeZone?: string;
  body?: string;
  location?: string;
  attendees?: string[];
  isAllDay?: boolean;
}) {
  const timeZone = args.timeZone || "America/Denver";
  const data = await graphRequest(userPath("/events"), {
    method: "POST",
    body: {
      subject: args.subject,
      body: args.body
        ? { contentType: "Text", content: args.body }
        : undefined,
      start: { dateTime: args.start, timeZone },
      end: { dateTime: args.end, timeZone },
      location: args.location ? { displayName: args.location } : undefined,
      attendees: (args.attendees || []).map((address) => ({
        emailAddress: { address },
        type: "required",
      })),
      isAllDay: args.isAllDay ?? false,
    },
  });
  return ok(data);
}

async function updateCalendarEvent(args: {
  eventId: string;
  subject?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  body?: string;
  location?: string;
}) {
  const timeZone = args.timeZone || "America/Denver";
  const body: Record<string, unknown> = {};
  if (args.subject !== undefined) body.subject = args.subject;
  if (args.body !== undefined) body.body = { contentType: "Text", content: args.body };
  if (args.location !== undefined) body.location = { displayName: args.location };
  if (args.start) body.start = { dateTime: args.start, timeZone };
  if (args.end) body.end = { dateTime: args.end, timeZone };
  const data = await graphRequest(
    userPath(`/events/${encodeURIComponent(args.eventId)}`),
    { method: "PATCH", body },
  );
  return ok(data);
}

async function deleteCalendarEvent(args: { eventId: string }) {
  await graphRequest(userPath(`/events/${encodeURIComponent(args.eventId)}`), {
    method: "DELETE",
  });
  return ok({ deleted: true, eventId: args.eventId });
}

// ─── Contacts / People ───────────────────────────────────────────────────────

async function listContacts(args: { top?: number; search?: string }) {
  const top = Math.min(Math.max(args.top ?? 20, 1), 50);
  const params = new URLSearchParams({
    $top: String(top),
    $select: "id,displayName,emailAddresses,companyName,jobTitle,mobilePhone",
  });
  if (args.search?.trim()) {
    params.set("$filter", `startswith(displayName,'${args.search.trim().replace(/'/g, "")}')`);
  }
  const data = await graphRequest<{ value: unknown[] }>(
    userPath(`/contacts?${params}`),
  );
  return ok({ contacts: data.value ?? [] });
}

// ─── OneDrive / Files ────────────────────────────────────────────────────────

async function listOneDriveChildren(args: { path?: string; top?: number }) {
  const top = Math.min(Math.max(args.top ?? 25, 1), 50);
  const path = args.path?.trim();
  const url = path
    ? userPath(`/drive/root:/${encodePath(path)}:/children?$top=${top}`)
    : userPath(`/drive/root/children?$top=${top}`);
  const data = await graphRequest<{ value: unknown[] }>(url);
  return ok({ items: data.value ?? [] });
}

async function searchOneDrive(args: { query: string; top?: number }) {
  const top = Math.min(Math.max(args.top ?? 20, 1), 50);
  const data = await graphRequest<{ value: unknown[] }>(
    userPath(
      `/drive/root/search(q='${encodeURIComponent(args.query.replace(/'/g, ""))}')?$top=${top}`,
    ),
  );
  return ok({ items: data.value ?? [] });
}

// ─── SharePoint ──────────────────────────────────────────────────────────────

async function createSharePointNote(args: {
  title: string;
  content: string;
  folder?: string;
}) {
  const config = requireConfig();
  const folder = args.folder || config.sharePointDefaultFolder;
  const site = await graphRequest<{ id?: string }>(
    `https://graph.microsoft.com/v1.0/sites/${config.sharePointSite}`,
  );
  if (!site.id) throw new Error("Could not resolve SharePoint site.");

  const drives = await graphRequest<{ value?: Array<{ id: string }> }>(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`,
  );
  const driveId = drives.value?.[0]?.id;
  if (!driveId) throw new Error("Could not find SharePoint document library.");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeTitle = args.title.slice(0, 40).replace(/[^\w\- ]+/g, "").replace(/\s+/g, "_");
  const filename = `Note_${timestamp}_${safeTitle || "untitled"}.txt`;
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodePath(folder)}/${encodeURIComponent(filename)}:/content`;

  const data = await graphRequest<{ webUrl?: string; name?: string }>(uploadUrl, {
    method: "PUT",
    rawBody: args.content,
    contentType: "text/plain",
  });
  return ok({ filename: data.name || filename, webUrl: data.webUrl });
}

async function resolveSharePointDrive() {
  const config = requireConfig();
  const site = await graphRequest<{
    id?: string;
    displayName?: string;
    webUrl?: string;
  }>(`https://graph.microsoft.com/v1.0/sites/${config.sharePointSite}`);
  if (!site.id) throw new Error("Could not resolve SharePoint site.");
  const drives = await graphRequest<{
    value?: Array<{ id: string; name?: string }>;
  }>(`https://graph.microsoft.com/v1.0/sites/${site.id}/drives`);
  const drive = drives.value?.[0];
  if (!drive?.id) throw new Error("Could not find SharePoint document library.");
  return {
    siteId: site.id,
    siteName: site.displayName || config.sharePointSite,
    siteUrl: site.webUrl || null,
    driveId: drive.id,
    driveName: drive.name || "Documents",
    defaultFolder: config.sharePointDefaultFolder,
  };
}

async function listSharePointFolder(args: { folder?: string; top?: number }) {
  const top = Math.min(Math.max(args.top ?? 25, 1), 50);
  const ctx = await resolveSharePointDrive();
  // Empty string / "." means library root.
  const requested =
    args.folder === undefined || args.folder === null
      ? ctx.defaultFolder
      : args.folder.trim();
  const folder = requested === "." ? "" : requested;

  const listUrl = folder
    ? `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/root:/${encodePath(folder)}:/children?$top=${top}&$select=id,name,size,webUrl,lastModifiedDateTime,folder,file`
    : `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/root/children?$top=${top}&$select=id,name,size,webUrl,lastModifiedDateTime,folder,file`;

  try {
    const data = await graphRequest<{
      value?: Array<{
        id?: string;
        name?: string;
        size?: number;
        webUrl?: string;
        lastModifiedDateTime?: string;
        folder?: unknown;
        file?: unknown;
      }>;
    }>(listUrl);
    const items = (data.value || []).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.folder ? "folder" : "file",
      size: item.size ?? null,
      webUrl: item.webUrl ?? null,
      lastModifiedDateTime: item.lastModifiedDateTime ?? null,
    }));
    return ok({
      site: ctx.siteName,
      siteUrl: ctx.siteUrl,
      library: ctx.driveName,
      folder: folder || "(root)",
      count: items.length,
      items,
    });
  } catch (error) {
    // Folder missing — return root listing so Dina can still navigate.
    const root = await graphRequest<{
      value?: Array<{ name?: string; folder?: unknown; webUrl?: string }>;
    }>(
      `https://graph.microsoft.com/v1.0/drives/${ctx.driveId}/root/children?$top=${top}&$select=name,folder,webUrl`,
    );
    const available = (root.value || []).map((item) => ({
      name: item.name,
      kind: item.folder ? "folder" : "file",
      webUrl: item.webUrl ?? null,
    }));
    return ok({
      site: ctx.siteName,
      siteUrl: ctx.siteUrl,
      library: ctx.driveName,
      folder: folder || "(root)",
      count: 0,
      items: [],
      warning:
        error instanceof Error
          ? `Folder not found (${error.message}). Showing library root instead.`
          : "Folder not found. Showing library root instead.",
      rootItems: available,
    });
  }
}

async function resolveSharePointSite() {
  const config = requireConfig();
  const site = await graphRequest<{
    id?: string;
    displayName?: string;
    webUrl?: string;
  }>(`https://graph.microsoft.com/v1.0/sites/${config.sharePointSite}`);
  if (!site.id) throw new Error("Could not resolve SharePoint site.");
  return {
    siteId: site.id,
    siteName: site.displayName || config.sharePointSite,
    siteUrl: site.webUrl || null,
  };
}

async function listSharePointLists(args: { top?: number }) {
  const top = Math.min(Math.max(args.top ?? 50, 1), 100);
  const site = await resolveSharePointSite();
  const data = await graphRequest<{
    value?: Array<{
      id?: string;
      name?: string;
      displayName?: string;
      webUrl?: string;
      list?: { template?: string };
    }>;
  }>(
    `https://graph.microsoft.com/v1.0/sites/${site.siteId}/lists?$select=id,name,displayName,webUrl,list&$top=${top}`,
  );

  const lists = (data.value || []).map((list) => ({
    id: list.id,
    name: list.name,
    displayName: list.displayName || list.name,
    webUrl: list.webUrl || null,
    template: list.list?.template || null,
    kind:
      list.list?.template === "documentLibrary"
        ? "documentLibrary"
        : list.list?.template === "genericList" ||
            list.list?.template === "contacts"
          ? "list"
          : list.list?.template || "list",
  }));

  return ok({
    site: site.siteName,
    siteUrl: site.siteUrl,
    count: lists.length,
    note: "SharePoint lists (including custom lists like Network Info) are separate from document library folders. Use get_sharepoint_list_items with listName or listId.",
    lists,
  });
}

async function getSharePointListItems(args: {
  listName?: string;
  listId?: string;
  search?: string;
  top?: number;
}) {
  const top = Math.min(Math.max(args.top ?? 50, 1), 100);
  const site = await resolveSharePointSite();

  let listId = args.listId?.trim();
  let listMeta: {
    id?: string;
    name?: string;
    displayName?: string;
    webUrl?: string;
  } | null = null;

  if (!listId) {
    const wanted = (args.listName || "").trim();
    if (!wanted) {
      // Help the model recover when forced without args.
      const listed = await listSharePointLists({ top: 50 });
      return listed;
    }
    const listed = await graphRequest<{
      value?: Array<{
        id?: string;
        name?: string;
        displayName?: string;
        webUrl?: string;
      }>;
    }>(
      `https://graph.microsoft.com/v1.0/sites/${site.siteId}/lists?$select=id,name,displayName,webUrl&$top=100`,
    );
    const match = (listed.value || []).find((list) => {
      const display = (list.displayName || "").toLowerCase();
      const name = (list.name || "").toLowerCase();
      const q = wanted.toLowerCase();
      return display === q || name === q || display.includes(q) || name.includes(q);
    });
    if (!match?.id) {
      const available = (listed.value || []).map(
        (list) => list.displayName || list.name,
      );
      throw new Error(
        `SharePoint list not found: ${wanted}. Available: ${available.join(", ")}`,
      );
    }
    listId = match.id;
    listMeta = match;
  } else {
    listMeta = await graphRequest<{
      id?: string;
      name?: string;
      displayName?: string;
      webUrl?: string;
    }>(
      `https://graph.microsoft.com/v1.0/sites/${site.siteId}/lists/${encodeURIComponent(listId)}?$select=id,name,displayName,webUrl`,
    );
  }

  const data = await graphRequest<{
    value?: Array<{
      id?: string;
      webUrl?: string;
      fields?: Record<string, unknown>;
    }>;
  }>(
    `https://graph.microsoft.com/v1.0/sites/${site.siteId}/lists/${encodeURIComponent(listId)}/items?$expand=fields&$top=${top}`,
  );

  const search = args.search?.trim().toLowerCase();
  let items = (data.value || []).map((item) => {
    const fields = item.fields || {};
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith("@odata")) continue;
      if (typeof value === "string" && /<|>/.test(value)) {
        cleaned[key] = stripHtml(value);
      } else {
        cleaned[key] = value;
      }
    }
    return {
      id: item.id,
      webUrl: item.webUrl || null,
      title:
        typeof cleaned.Title === "string"
          ? cleaned.Title
          : typeof cleaned.title === "string"
            ? cleaned.title
            : null,
      fields: cleaned,
    };
  });

  if (search) {
    items = items.filter((item) =>
      JSON.stringify(item.fields).toLowerCase().includes(search),
    );
  }

  return ok({
    site: site.siteName,
    listId,
    listName: listMeta?.displayName || listMeta?.name || args.listName || listId,
    listUrl: listMeta?.webUrl || null,
    count: items.length,
    items,
  });
}

// ─── Planner ─────────────────────────────────────────────────────────────────

async function listPlannerPlans(args: { top?: number }) {
  const top = Math.min(Math.max(args.top ?? 25, 1), 50);
  // App-only: /users/{id}/planner/plans often 403s. Discover via group membership.
  const groups = await graphRequest<{
    value?: Array<{ id?: string; displayName?: string }>;
  }>(
    userPath(
      "/memberOf/microsoft.graph.group?$select=id,displayName&$top=50",
    ),
  );

  const plans: Array<{
    id: string;
    title: string;
    ownerGroupId: string;
    ownerGroupName: string;
  }> = [];

  for (const group of groups.value || []) {
    if (!group.id) continue;
    try {
      const data = await graphRequest<{
        value?: Array<{ id?: string; title?: string }>;
      }>(
        `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(group.id)}/planner/plans`,
      );
      for (const plan of data.value || []) {
        if (!plan.id) continue;
        plans.push({
          id: plan.id,
          title: plan.title || "(untitled plan)",
          ownerGroupId: group.id,
          ownerGroupName: group.displayName || group.id,
        });
      }
    } catch {
      // Group may not have Planner enabled — skip.
    }
    if (plans.length >= top) break;
  }

  return ok({
    count: plans.length,
    note: "Plans discovered via Derek's Microsoft 365 groups (app-only compatible).",
    plans: plans.slice(0, top),
  });
}

async function listPlannerTasks(args: { planId: string; top?: number }) {
  const top = Math.min(Math.max(args.top ?? 50, 1), 100);
  const data = await graphRequest<{
    value?: Array<{
      id?: string;
      title?: string;
      percentComplete?: number;
      dueDateTime?: string;
      bucketId?: string;
      createdDateTime?: string;
      completedDateTime?: string | null;
      "@odata.etag"?: string;
    }>;
  }>(
    `https://graph.microsoft.com/v1.0/planner/plans/${encodeURIComponent(args.planId)}/tasks?$top=${top}`,
  );
  const tasks = (data.value || []).map((task) => ({
    id: task.id,
    title: task.title,
    percentComplete: task.percentComplete ?? 0,
    dueDateTime: task.dueDateTime ?? null,
    bucketId: task.bucketId ?? null,
    completed: (task.percentComplete ?? 0) >= 100,
    etag: task["@odata.etag"] ?? null,
  }));
  return ok({
    planId: args.planId,
    count: tasks.length,
    openCount: tasks.filter((t) => !t.completed).length,
    tasks,
  });
}

async function listMyPlannerTasks(args: { top?: number }) {
  const top = Math.min(Math.max(args.top ?? 50, 1), 100);
  const data = await graphRequest<{
    value?: Array<{
      id?: string;
      title?: string;
      planId?: string;
      percentComplete?: number;
      dueDateTime?: string;
      bucketId?: string;
      "@odata.etag"?: string;
    }>;
  }>(userPath(`/planner/tasks?$top=${top}`));
  const tasks = (data.value || []).map((task) => ({
    id: task.id,
    title: task.title,
    planId: task.planId,
    percentComplete: task.percentComplete ?? 0,
    dueDateTime: task.dueDateTime ?? null,
    bucketId: task.bucketId ?? null,
    completed: (task.percentComplete ?? 0) >= 100,
    etag: task["@odata.etag"] ?? null,
  }));
  return ok({
    count: tasks.length,
    note: "Tasks assigned to Derek. For full plan boards, call list_planner_plans then list_planner_tasks.",
    tasks,
  });
}

async function listPlannerBuckets(args: { planId: string }) {
  const data = await graphRequest<{ value: unknown[] }>(
    `https://graph.microsoft.com/v1.0/planner/plans/${encodeURIComponent(args.planId)}/buckets`,
  );
  return ok({ buckets: data.value ?? [] });
}

async function createPlannerTask(args: {
  planId: string;
  title: string;
  bucketId?: string;
  dueDateTime?: string;
  assignments?: string[];
}) {
  const body: Record<string, unknown> = {
    planId: args.planId,
    title: args.title,
  };
  if (args.bucketId) body.bucketId = args.bucketId;
  if (args.dueDateTime) body.dueDateTime = args.dueDateTime;
  if (args.assignments?.length) {
    body.assignments = Object.fromEntries(
      args.assignments.map((userId) => [
        userId,
        { "@odata.type": "#microsoft.graph.plannerAssignment", orderHint: " !" },
      ]),
    );
  }
  const data = await graphRequest("https://graph.microsoft.com/v1.0/planner/tasks", {
    method: "POST",
    body,
  });
  return ok(data);
}

async function updatePlannerTask(args: {
  taskId: string;
  etag: string;
  title?: string;
  percentComplete?: number;
  dueDateTime?: string | null;
  bucketId?: string;
}) {
  const body: Record<string, unknown> = {};
  if (args.title !== undefined) body.title = args.title;
  if (args.percentComplete !== undefined) body.percentComplete = args.percentComplete;
  if (args.dueDateTime !== undefined) body.dueDateTime = args.dueDateTime;
  if (args.bucketId !== undefined) body.bucketId = args.bucketId;

  const data = await graphRequest(
    `https://graph.microsoft.com/v1.0/planner/tasks/${encodeURIComponent(args.taskId)}`,
    {
      method: "PATCH",
      body,
      headers: { "If-Match": args.etag },
    },
  );
  return ok(data);
}

// ─── Microsoft To Do ─────────────────────────────────────────────────────────

async function listTodoLists() {
  const data = await graphRequest<{ value: unknown[] }>(
    userPath("/todo/lists"),
  );
  return ok({ lists: data.value ?? [] });
}

async function listTodoTasks(args: { listId: string; top?: number }) {
  const top = Math.min(Math.max(args.top ?? 30, 1), 50);
  const data = await graphRequest<{ value: unknown[] }>(
    userPath(
      `/todo/lists/${encodeURIComponent(args.listId)}/tasks?$top=${top}&$filter=status ne 'completed'`,
    ),
  );
  return ok({ tasks: data.value ?? [] });
}

async function createTodoTask(args: {
  listId: string;
  title: string;
  body?: string;
  dueDateTime?: string;
  timeZone?: string;
}) {
  const body: Record<string, unknown> = { title: args.title };
  if (args.body) body.body = { content: args.body, contentType: "text" };
  if (args.dueDateTime) {
    body.dueDateTime = {
      dateTime: args.dueDateTime,
      timeZone: args.timeZone || "America/Denver",
    };
  }
  const data = await graphRequest(
    userPath(`/todo/lists/${encodeURIComponent(args.listId)}/tasks`),
    { method: "POST", body },
  );
  return ok(data);
}

// ─── Teams (best-effort with app permissions) ────────────────────────────────

async function listJoinedTeams() {
  const data = await graphRequest<{ value: unknown[] }>(userPath("/joinedTeams"));
  return ok({ teams: data.value ?? [] });
}

async function listTeamChannels(args: { teamId: string }) {
  const data = await graphRequest<{ value: unknown[] }>(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(args.teamId)}/channels`,
  );
  return ok({ channels: data.value ?? [] });
}

async function sendChannelMessage(args: {
  teamId: string;
  channelId: string;
  message: string;
}) {
  const data = await graphRequest(
    `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(args.teamId)}/channels/${encodeURIComponent(args.channelId)}/messages`,
    {
      method: "POST",
      body: {
        body: { contentType: "text", content: args.message },
      },
    },
  );
  return ok(data);
}

// ─── Registry ────────────────────────────────────────────────────────────────

export type MicrosoftToolHandler = (args: Record<string, unknown>) => Promise<string>;

export const microsoftToolHandlers: Record<string, MicrosoftToolHandler> = {
  list_inbox_messages: (args) =>
    listInboxMessages(
      args as { unreadOnly?: boolean; top?: number; search?: string; maxItems?: number },
    ).catch(fail),
  get_email: (args) => getEmail(args as { messageId: string }).catch(fail),
  get_emails: (args) => getEmails(args as { messageIds: string[] }).catch(fail),
  brief_inbox: (args) =>
    briefInbox(
      args as {
        unreadOnly?: boolean;
        top?: number;
        search?: string;
        autoClearNoise?: boolean;
      },
    ).catch(fail),
  mark_email_read: (args) =>
    markEmailRead(args as { messageId: string; isRead?: boolean }).catch(fail),
  mark_emails_read: (args) =>
    markEmailsRead(args as { messageIds: string[] }).catch(fail),
  mark_matching_emails_read: (args) =>
    markMatchingEmailsRead(
      args as {
        unreadOnly?: boolean;
        fromContains?: string;
        subjectContains?: string;
        search?: string;
        max?: number;
      },
    ).catch(fail),
  list_inbox_rules: () => listInboxRules().catch(fail),
  create_inbox_rule: (args) =>
    createInboxRule(
      args as {
        displayName: string;
        sequence?: number;
        isEnabled?: boolean;
        senderContains?: string[];
        subjectContains?: string[];
        bodyContains?: string[];
        fromAddresses?: string[];
        markAsRead?: boolean;
        delete?: boolean;
        moveToFolder?: string;
        forwardTo?: string[];
        stopProcessingRules?: boolean;
      },
    ).catch(fail),
  update_inbox_rule: (args) =>
    updateInboxRule(
      args as {
        ruleId: string;
        displayName?: string;
        sequence?: number;
        isEnabled?: boolean;
        markAsRead?: boolean;
        delete?: boolean;
        stopProcessingRules?: boolean;
      },
    ).catch(fail),
  delete_inbox_rule: (args) =>
    deleteInboxRule(args as { ruleId: string }).catch(fail),
  send_email: (args) =>
    sendEmail(
      args as {
        to: string | string[];
        subject: string;
        body: string;
        contentType?: "Text" | "HTML";
        cc?: string | string[];
      },
    ).catch(fail),
  create_reply_draft: (args) =>
    createReplyDraft(args as { messageId: string; comment?: string }).catch(fail),
  list_mail_folders: () => listMailFolders().catch(fail),
  list_child_mail_folders: (args) =>
    listChildMailFolders(args as { parentFolderId?: string }).catch(fail),
  create_mail_folder: (args) =>
    createMailFolder(
      args as { displayName: string; parentFolderId?: string },
    ).catch(fail),
  ensure_mail_folder: (args) =>
    ensureMailFolder(
      args as { displayName: string; parentFolderId?: string },
    ).catch(fail),
  list_calendar_events: (args) =>
    listCalendarEvents(args as { start?: string; end?: string; top?: number }).catch(fail),
  get_calendar_event: (args) =>
    getCalendarEvent(args as { eventId: string }).catch(fail),
  create_calendar_event: (args) =>
    createCalendarEvent(
      args as {
        subject: string;
        start: string;
        end: string;
        timeZone?: string;
        body?: string;
        location?: string;
        attendees?: string[];
        isAllDay?: boolean;
      },
    ).catch(fail),
  update_calendar_event: (args) =>
    updateCalendarEvent(
      args as {
        eventId: string;
        subject?: string;
        start?: string;
        end?: string;
        timeZone?: string;
        body?: string;
        location?: string;
      },
    ).catch(fail),
  delete_calendar_event: (args) =>
    deleteCalendarEvent(args as { eventId: string }).catch(fail),
  list_contacts: (args) =>
    listContacts(args as { top?: number; search?: string }).catch(fail),
  list_onedrive_children: (args) =>
    listOneDriveChildren(args as { path?: string; top?: number }).catch(fail),
  search_onedrive: (args) =>
    searchOneDrive(args as { query: string; top?: number }).catch(fail),
  create_sharepoint_note: (args) =>
    createSharePointNote(
      args as { title: string; content: string; folder?: string },
    ).catch(fail),
  list_sharepoint_folder: (args) =>
    listSharePointFolder(args as { folder?: string; top?: number }).catch(fail),
  list_sharepoint_lists: (args) =>
    listSharePointLists(args as { top?: number }).catch(fail),
  get_sharepoint_list_items: (args) =>
    getSharePointListItems(
      args as {
        listName?: string;
        listId?: string;
        search?: string;
        top?: number;
      },
    ).catch(fail),
  list_planner_plans: (args) =>
    listPlannerPlans(args as { top?: number }).catch(fail),
  list_planner_tasks: (args) =>
    listPlannerTasks(args as { planId: string; top?: number }).catch(fail),
  list_my_planner_tasks: (args) =>
    listMyPlannerTasks(args as { top?: number }).catch(fail),
  list_planner_buckets: (args) =>
    listPlannerBuckets(args as { planId: string }).catch(fail),
  create_planner_task: (args) =>
    createPlannerTask(
      args as {
        planId: string;
        title: string;
        bucketId?: string;
        dueDateTime?: string;
        assignments?: string[];
      },
    ).catch(fail),
  update_planner_task: (args) =>
    updatePlannerTask(
      args as {
        taskId: string;
        etag: string;
        title?: string;
        percentComplete?: number;
        dueDateTime?: string | null;
        bucketId?: string;
      },
    ).catch(fail),
  list_todo_lists: () => listTodoLists().catch(fail),
  list_todo_tasks: (args) =>
    listTodoTasks(args as { listId: string; top?: number }).catch(fail),
  create_todo_task: (args) =>
    createTodoTask(
      args as {
        listId: string;
        title: string;
        body?: string;
        dueDateTime?: string;
        timeZone?: string;
      },
    ).catch(fail),
  list_joined_teams: () => listJoinedTeams().catch(fail),
  list_team_channels: (args) =>
    listTeamChannels(args as { teamId: string }).catch(fail),
  send_channel_message: (args) =>
    sendChannelMessage(
      args as { teamId: string; channelId: string; message: string },
    ).catch(fail),
};

export function listMicrosoftToolNames() {
  return Object.keys(microsoftToolHandlers);
}

export async function executeMicrosoftTool(
  name: string,
  argsJson: string,
): Promise<string> {
  const handler = microsoftToolHandlers[name];
  if (!handler) {
    return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
  }
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ ok: false, error: "Invalid tool arguments JSON." });
  }
  return handler(args);
}
