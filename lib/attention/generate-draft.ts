import { recipientFromAttentionRaw } from "@/lib/attention/send";
import { draftInDereksVoice } from "@/lib/writing/draft";
import type { DraftRequest } from "@/lib/writing/types";

type AttentionDraftSource = {
  source: string;
  sender?: string | null;
  subject?: string | null;
  summary: string;
  whyItMatters: string;
  recommendedAction: string;
  rawJson?: string | null;
};

/** Build the Writing Assistant request — no model call. */
export function attentionDraftRequest(item: AttentionDraftSource): DraftRequest {
  const to = recipientFromAttentionRaw(item.rawJson, item.sender);
  const medium = item.source === "github" ? "github_review" : "email";
  return {
    medium,
    to,
    purpose: [
      `Reply to: ${item.subject || "(no subject)"}`,
      item.sender ? `From: ${item.sender}` : null,
      item.whyItMatters ? `Project: ${item.whyItMatters}` : null,
      item.recommendedAction
        ? `Recommended action: ${item.recommendedAction}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    points: [item.summary].filter(Boolean),
  };
}

/** Draft a reply when Derek opens the card — not during the scan. */
export async function generateAttentionDraft(item: AttentionDraftSource) {
  const result = await draftInDereksVoice(attentionDraftRequest(item));
  return {
    draftSubject:
      result.subject ||
      (item.subject ? `Re: ${item.subject}` : result.subject),
    draftBody: result.body,
  };
}
