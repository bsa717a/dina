import { providerIdFromSourceId } from "@/lib/attention/provider";
import type { AttentionSource } from "@/lib/attention/types";

/** Sources that can send an email draft from Attention Engine. */
export const EMAILABLE_ATTENTION_SOURCES: ReadonlySet<AttentionSource> = new Set([
  "email",
  "meeting_invite",
  "calendar",
]);

export function canSendAttentionDraft(source: string): boolean {
  return EMAILABLE_ATTENTION_SOURCES.has(source as AttentionSource);
}

/**
 * Attention sourceIds are often prefixed (`microsoft365:email:…` / `google:email:…`).
 * Vendor APIs need the bare resource id.
 */
export function graphIdFromSourceId(sourceId: string): string {
  return providerIdFromSourceId(sourceId);
}

export function recipientFromAttentionRaw(
  rawJson: string | null | undefined,
  sender: string | null | undefined,
): string | undefined {
  let fromAddress: string | undefined;
  try {
    const raw = rawJson
      ? (JSON.parse(rawJson) as {
          senderEmail?: string;
          payload?: { fromAddress?: string; organizerAddress?: string };
          event?: {
            payload?: { fromAddress?: string; organizerAddress?: string };
          };
        })
      : null;
    fromAddress =
      raw?.senderEmail ||
      raw?.payload?.fromAddress ||
      raw?.payload?.organizerAddress ||
      raw?.event?.payload?.fromAddress ||
      raw?.event?.payload?.organizerAddress;
  } catch {
    fromAddress = undefined;
  }
  if (!fromAddress && sender?.includes("@")) fromAddress = sender;

  // Fallback: Organizer: Name <email@domain> in stored summary/raw text.
  if (!fromAddress && rawJson) {
    const match = rawJson.match(/<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i);
    if (match?.[1]) fromAddress = match[1];
  }

  return fromAddress?.trim() || undefined;
}
