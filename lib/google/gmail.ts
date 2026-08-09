import { googleRequest } from "@/lib/google/auth";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailHeader = { name?: string; value?: string };

export type GmailMessageListItem = {
  id: string;
  threadId?: string;
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: GmailHeader[];
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: GmailMessagePart[];
  };
};

type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
};

function headerValue(headers: GmailHeader[] | undefined, name: string) {
  const want = name.toLowerCase();
  return (
    headers?.find((h) => (h.name || "").toLowerCase() === want)?.value || null
  );
}

export function parseFromHeader(value: string | null): {
  name: string | null;
  address: string | null;
} {
  if (!value?.trim()) return { name: null, address: null };
  const angle = value.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (angle) {
    return {
      name: angle[1].replace(/^"|"$/g, "").trim() || null,
      address: angle[2].trim().toLowerCase(),
    };
  }
  if (value.includes("@")) {
    return { name: null, address: value.trim().toLowerCase() };
  }
  return { name: value.trim(), address: null };
}

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function collectParts(
  part: GmailMessagePart | undefined,
  acc: { text: string[]; html: string[] },
) {
  if (!part) return;
  const mime = (part.mimeType || "").toLowerCase();
  const data = part.body?.data;
  if (data && mime === "text/plain") {
    acc.text.push(decodeBase64Url(data));
  } else if (data && mime === "text/html") {
    acc.html.push(decodeBase64Url(data));
  }
  for (const child of part.parts || []) collectParts(child, acc);
}

export function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractGmailTextBody(message: GmailMessage): string {
  const acc = { text: [] as string[], html: [] as string[] };
  collectParts(message.payload, acc);
  if (acc.text.length) return acc.text.join("\n\n").trim();
  if (acc.html.length) return htmlToText(acc.html.join("\n")).trim();
  const data = message.payload?.body?.data;
  if (data) {
    const raw = decodeBase64Url(data);
    if ((message.payload?.mimeType || "").includes("html")) return htmlToText(raw);
    return raw.trim();
  }
  return (message.snippet || "").trim();
}

export function summarizeGmailHeaders(message: GmailMessage) {
  const headers = message.payload?.headers || [];
  const from = parseFromHeader(headerValue(headers, "From"));
  const toRaw = headerValue(headers, "To");
  const ccRaw = headerValue(headers, "Cc");
  const subject = headerValue(headers, "Subject");
  const date = headerValue(headers, "Date");
  const listUnsubscribe = headerValue(headers, "List-Unsubscribe");
  return {
    id: message.id,
    threadId: message.threadId || null,
    subject,
    fromName: from.name,
    fromAddress: from.address,
    to: toRaw,
    cc: ccRaw,
    date,
    listUnsubscribe,
    labelIds: message.labelIds || [],
    snippet: message.snippet || "",
    internalDate: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : null,
  };
}

export async function listGmailMessageIds(args: {
  q?: string;
  maxResults?: number;
  pageToken?: string;
}) {
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(args.maxResults ?? 40, 1), 100)),
  });
  if (args.q?.trim()) params.set("q", args.q.trim());
  if (args.pageToken) params.set("pageToken", args.pageToken);

  return googleRequest<{
    messages?: GmailMessageListItem[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(`${GMAIL}/messages?${params}`);
}

export async function getGmailMessage(
  id: string,
  format: "metadata" | "full" | "minimal" = "full",
  metadataHeaders?: string[],
) {
  const params = new URLSearchParams({ format });
  for (const h of metadataHeaders || [
    "From",
    "To",
    "Cc",
    "Subject",
    "Date",
    "List-Unsubscribe",
  ]) {
    params.append("metadataHeaders", h);
  }
  return googleRequest<GmailMessage>(
    `${GMAIL}/messages/${encodeURIComponent(id)}?${params}`,
  );
}

/**
 * Models sometimes truncate Gmail ids. Resolve exact / prefix / recent unread.
 */
export async function resolveGmailMessageId(rawId: string): Promise<string> {
  const id = rawId.trim();
  if (!id) throw new Error("messageId is required.");

  try {
    await getGmailMessage(id, "minimal");
    return id;
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status)
        : 0;
    if (status && status !== 404) throw error;
  }

  // Prefix match against recent inbox (unread first, then broader).
  for (const q of ["is:unread -in:spam -in:trash", "in:inbox -in:spam newer_than:14d"]) {
    const listed = await listGmailMessageIds({ q, maxResults: 50 });
    const matches = (listed.messages || []).filter((m) =>
      m.id.startsWith(id),
    );
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous messageId prefix "${id}" matched ${matches.length} messages. Use the full id from gmail_brief_inbox.`,
      );
    }
  }

  throw new Error(
    `Gmail message not found for id "${id}". Use the exact emails[].id from gmail_brief_inbox (do not truncate).`,
  );
}

export async function modifyGmailLabels(
  id: string,
  input: { addLabelIds?: string[]; removeLabelIds?: string[] },
) {
  return googleRequest(`${GMAIL}/messages/${encodeURIComponent(id)}/modify`, {
    method: "POST",
    body: {
      addLabelIds: input.addLabelIds || [],
      removeLabelIds: input.removeLabelIds || [],
    },
  });
}

export async function markGmailRead(id: string, isRead = true) {
  if (isRead) {
    return modifyGmailLabels(id, { removeLabelIds: ["UNREAD"] });
  }
  return modifyGmailLabels(id, { addLabelIds: ["UNREAD"] });
}

export async function listGmailLabels() {
  return googleRequest<{
    labels?: Array<{ id?: string; name?: string; type?: string }>;
  }>(`${GMAIL}/labels`);
}

function encodeRawEmail(raw: string) {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmailMessage(input: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}) {
  const lines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) lines.push(`References: ${input.references}`);
  lines.push("", input.body);
  const raw = encodeRawEmail(lines.join("\r\n"));

  return googleRequest<{ id?: string; threadId?: string }>(`${GMAIL}/messages/send`, {
    method: "POST",
    body: {
      raw,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  });
}

export async function createGmailDraft(input: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}) {
  const lines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=utf-8",
  ];
  if (input.inReplyTo) lines.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) lines.push(`References: ${input.references}`);
  lines.push("", input.body);
  const raw = encodeRawEmail(lines.join("\r\n"));

  return googleRequest<{ id?: string; message?: { id?: string; threadId?: string } }>(
    `${GMAIL}/drafts`,
    {
      method: "POST",
      body: {
        message: {
          raw,
          ...(input.threadId ? { threadId: input.threadId } : {}),
        },
      },
    },
  );
}

export async function createGmailReplyDraft(input: {
  messageId: string;
  body: string;
  subject?: string;
}) {
  const original = await getGmailMessage(input.messageId, "full");
  const headers = original.payload?.headers || [];
  const from = parseFromHeader(headerValue(headers, "From"));
  const messageIdHeader = headerValue(headers, "Message-ID") || headerValue(headers, "Message-Id");
  const subject =
    input.subject ||
    (() => {
      const s = headerValue(headers, "Subject") || "";
      return /^re:/i.test(s) ? s : `Re: ${s}`;
    })();
  if (!from.address) throw new Error("Original Gmail message has no From address.");

  return createGmailDraft({
    to: from.address,
    subject,
    body: input.body,
    threadId: original.threadId,
    inReplyTo: messageIdHeader || undefined,
    references: messageIdHeader || undefined,
  });
}
