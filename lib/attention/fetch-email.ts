import { graphIdFromSourceId } from "@/lib/attention/send";
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
      const text = String(label).replace(/<[^>]+>/g, "").trim() || String(href);
      return text;
    })
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

export function canViewAttentionEmail(source: string): boolean {
  return source === "email";
}

export async function fetchAttentionEmail(
  sourceId: string,
): Promise<AttentionEmailView> {
  const messageId = graphIdFromSourceId(sourceId);
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
  };
}
