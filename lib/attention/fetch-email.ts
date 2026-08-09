import {
  attentionProviderFromSourceId,
  providerIdFromSourceId,
} from "@/lib/attention/provider";
import {
  extractGmailTextBody,
  getGmailMessage,
  htmlToText,
  parseFromHeader,
  summarizeGmailHeaders,
} from "@/lib/google/gmail";
import { graphRequest, userPath } from "@/lib/microsoft/graph";

type GraphAddress = {
  emailAddress?: { name?: string; address?: string };
};

export type AttentionEmailAddress = {
  name: string | null;
  address: string | null;
  display: string;
};

export type AttentionEmailView = {
  id: string;
  subject: string | null;
  from: AttentionEmailAddress | null;
  to: AttentionEmailAddress[];
  cc: AttentionEmailAddress[];
  receivedDateTime: string | null;
  hasAttachments: boolean;
  importance: string | null;
  bodyText: string;
  bodyTruncated: boolean;
  accountLabel?: string | null;
};

function formatAddress(entry?: GraphAddress | null): AttentionEmailAddress | null {
  const name = entry?.emailAddress?.name?.trim() || null;
  const address = entry?.emailAddress?.address?.trim() || null;
  if (!name && !address) return null;
  const display =
    name && address ? `${name} <${address}>` : name || address || "";
  return { name, address, display };
}

function formatAddressList(list: unknown): AttentionEmailAddress[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => formatAddress(entry as GraphAddress))
    .filter((entry): entry is AttentionEmailAddress => Boolean(entry));
}

function displayAddress(name: string | null, address: string | null): AttentionEmailAddress | null {
  if (!name && !address) return null;
  const display =
    name && address ? `${name} <${address}>` : name || address || "";
  return { name, address, display };
}

function parseAddressList(raw: string | null): AttentionEmailAddress[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => {
      const parsed = parseFromHeader(part.trim());
      return displayAddress(parsed.name, parsed.address);
    })
    .filter((entry): entry is AttentionEmailAddress => Boolean(entry));
}

export function canViewAttentionEmail(source: string): boolean {
  return source === "email";
}

async function fetchMicrosoftEmail(messageId: string): Promise<AttentionEmailView> {
  const data = await graphRequest<{
    id?: string;
    subject?: string;
    from?: GraphAddress;
    toRecipients?: unknown;
    ccRecipients?: unknown;
    receivedDateTime?: string;
    hasAttachments?: boolean;
    importance?: string;
    body?: { contentType?: string; content?: string };
    bodyPreview?: string;
  }>(
    userPath(
      `/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,body,bodyPreview,hasAttachments,importance`,
    ),
  );

  const raw = data.body?.content || "";
  const contentType = data.body?.contentType || "Text";
  const textBody =
    contentType.toLowerCase() === "html" ? htmlToText(raw) : raw.trim();
  const clipped = textBody.slice(0, 50_000);

  return {
    id: data.id || messageId,
    subject: data.subject || null,
    from: formatAddress(data.from),
    to: formatAddressList(data.toRecipients),
    cc: formatAddressList(data.ccRecipients),
    receivedDateTime: data.receivedDateTime || null,
    hasAttachments: Boolean(data.hasAttachments),
    importance: data.importance || null,
    bodyText: clipped || data.bodyPreview || "(No body)",
    bodyTruncated: textBody.length > clipped.length,
    accountLabel: "work",
  };
}

async function fetchGoogleEmail(messageId: string): Promise<AttentionEmailView> {
  const full = await getGmailMessage(messageId, "full");
  const summary = summarizeGmailHeaders(full);
  const textBody = extractGmailTextBody(full);
  const clipped = textBody.slice(0, 50_000);

  return {
    id: summary.id,
    subject: summary.subject,
    from: displayAddress(summary.fromName, summary.fromAddress),
    to: parseAddressList(summary.to),
    cc: parseAddressList(summary.cc),
    receivedDateTime: summary.internalDate,
    hasAttachments: false,
    importance: null,
    bodyText: clipped || summary.snippet || "(No body)",
    bodyTruncated: textBody.length > clipped.length,
    accountLabel: "personal",
  };
}

export async function fetchAttentionEmail(
  sourceId: string,
): Promise<AttentionEmailView> {
  const messageId = providerIdFromSourceId(sourceId);
  const provider = attentionProviderFromSourceId(sourceId);
  if (provider === "google") return fetchGoogleEmail(messageId);
  return fetchMicrosoftEmail(messageId);
}
