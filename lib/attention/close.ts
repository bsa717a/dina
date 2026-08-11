import { markAttentionSourceHandled } from "@/lib/attention/mark-handled";
import {
  listOpenAttentionItems,
  recordAttentionAction,
  updateAttentionItemStatus,
} from "@/lib/attention/store";
import type { AttentionActionType } from "@/lib/attention/types";
import { scheduleLearnFromAttentionAction } from "@/lib/learning/distill";

type CloseableItem = {
  id: string;
  source: string;
  sourceId: string;
  subject: string | null;
  summary: string;
  rawJson: string | null;
};

export async function closeAttentionItem(
  item: CloseableItem,
  status: "resolved" | "dismissed" | "sent",
  action: Extract<
    AttentionActionType,
    | "accepted_recommendation"
    | "dismissed_unimportant"
    | "blocked_sender"
    | "sent_draft"
  >,
  details?: Record<string, unknown>,
) {
  const marked = await markAttentionSourceHandled(item);
  await updateAttentionItemStatus(item.id, status, {
    draftSubject:
      typeof details?.subject === "string" ? details.subject : undefined,
    draftBody: typeof details?.body === "string" ? details.body : undefined,
  });
  await recordAttentionAction({
    attentionItemId: item.id,
    action,
    details: { ...details, markedRead: marked },
  });
  if (
    action === "accepted_recommendation" ||
    action === "dismissed_unimportant" ||
    action === "sent_draft"
  ) {
    scheduleLearnFromAttentionAction({
      attentionItemId: item.id,
      action,
      details: { ...details, markedRead: marked },
    });
  }
  return marked;
}

/** Resolve every open attention card (Done for all). */
export async function markAllAttentionDone() {
  // Do not wake expired snoozes here — Mark all done should only clear cards
  // already open in the queue, not silently resolve items still snoozed.
  const items = await listOpenAttentionItems({ wakeSnoozes: false });
  let resolved = 0;
  for (const item of items) {
    await closeAttentionItem(item, "resolved", "accepted_recommendation", {
      bulk: true,
    });
    resolved += 1;
  }
  return { resolved };
}
