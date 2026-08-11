import {
  recordAttentionAction,
  updateAttentionItemStatus,
} from "@/lib/attention/store";
import { ATTENTION_SNOOZE_MS } from "@/lib/attention/types";

export async function snoozeAttentionItem(item: { id: string }) {
  const snoozedUntil = new Date(Date.now() + ATTENTION_SNOOZE_MS);
  const updated = await updateAttentionItemStatus(item.id, "snoozed", {
    snoozedUntil,
  });
  await recordAttentionAction({
    attentionItemId: item.id,
    action: "snoozed",
    details: { snoozedUntil: snoozedUntil.toISOString() },
  });
  return updated;
}
