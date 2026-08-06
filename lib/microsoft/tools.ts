import { getMicrosoftConfig } from "@/lib/microsoft/config";
import { GraphError, graphRequest, userPath } from "@/lib/microsoft/graph";

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

// ─── Mail ────────────────────────────────────────────────────────────────────

type GraphMessage = {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  isRead?: boolean;
  bodyPreview?: string;
  hasAttachments?: boolean;
  importance?: string;
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
    "id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments,importance";
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

/** One-shot inbox briefing with bodies — preferred for digests/summaries. */
async function briefInbox(args: {
  unreadOnly?: boolean;
  top?: number;
  search?: string;
}) {
  const top = Math.min(Math.max(args.top ?? 8, 1), 12);
  const page = await fetchMessagesPage({
    unreadOnly: args.unreadOnly ?? true,
    search: args.search,
    top,
    maxItems: top,
    maxPages: 1,
  });

  const emails = [];
  const errors: string[] = [];
  for (const message of page.messages) {
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
    hasMore: page.hasMore,
    emails,
    errors,
    guidance:
      "Brief Derek from textBody only. Do not include Links sections, tracking URLs, SendGrid click wrappers, or Outlook/OWA links.",
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
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const id of args.messageIds.slice(0, 200)) {
    try {
      await graphRequest(userPath(`/messages/${encodeURIComponent(id)}`), {
        method: "PATCH",
        body: { isRead: true },
      });
      success += 1;
    } catch (error) {
      failed += 1;
      errors.push(error instanceof Error ? error.message : "failed");
    }
  }
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
  const top = Math.min(Math.max(args.top ?? 20, 1), 50);
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
      "id,subject,start,end,location,organizer,isAllDay,webLink,bodyPreview,attendees,showAs",
  });
  const data = await graphRequest<{ value: unknown[] }>(
    userPath(`/calendarView?${params}`),
  );
  return ok({ count: data.value?.length ?? 0, events: data.value ?? [] });
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

async function listSharePointFolder(args: { folder?: string; top?: number }) {
  const config = requireConfig();
  const folder = args.folder || config.sharePointDefaultFolder;
  const top = Math.min(Math.max(args.top ?? 25, 1), 50);
  const site = await graphRequest<{ id?: string }>(
    `https://graph.microsoft.com/v1.0/sites/${config.sharePointSite}`,
  );
  if (!site.id) throw new Error("Could not resolve SharePoint site.");
  const drives = await graphRequest<{ value?: Array<{ id: string }> }>(
    `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`,
  );
  const driveId = drives.value?.[0]?.id;
  if (!driveId) throw new Error("Could not find SharePoint document library.");
  const data = await graphRequest<{ value: unknown[] }>(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodePath(folder)}:/children?$top=${top}`,
  );
  return ok({ folder, items: data.value ?? [] });
}

// ─── Planner ─────────────────────────────────────────────────────────────────

async function listPlannerPlans(args: { top?: number }) {
  const top = Math.min(Math.max(args.top ?? 25, 1), 50);
  const data = await graphRequest<{ value: unknown[] }>(
    userPath(`/planner/plans?$top=${top}`),
  );
  return ok({ plans: data.value ?? [] });
}

async function listPlannerTasks(args: { planId: string; top?: number }) {
  const top = Math.min(Math.max(args.top ?? 50, 1), 100);
  const data = await graphRequest<{ value: unknown[] }>(
    `https://graph.microsoft.com/v1.0/planner/plans/${encodeURIComponent(args.planId)}/tasks?$top=${top}`,
  );
  return ok({ tasks: data.value ?? [] });
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
      args as { unreadOnly?: boolean; top?: number; search?: string },
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
  list_planner_plans: (args) =>
    listPlannerPlans(args as { top?: number }).catch(fail),
  list_planner_tasks: (args) =>
    listPlannerTasks(args as { planId: string; top?: number }).catch(fail),
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
