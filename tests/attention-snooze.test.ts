import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { markAllAttentionDone } from "@/lib/attention/close";
import { snoozeAttentionItem } from "@/lib/attention/snooze";
import {
  listOpenAttentionItems,
  upsertClassifiedItems,
  wakeExpiredSnoozes,
} from "@/lib/attention/store";
import {
  ATTENTION_SNOOZE_MS,
  type ClassifiedAttention,
} from "@/lib/attention/types";

const SOURCE_ID = "microsoft365:email:snooze-test";

function baseItem(
  overrides: Partial<ClassifiedAttention> = {},
): ClassifiedAttention {
  return {
    source: "email",
    sourceId: SOURCE_ID,
    category: "reply_required",
    sender: "Pat",
    subject: "Quick question",
    summary: "Needs a reply later",
    whyItMatters: "Timing",
    recommendedAction: "Reply when free",
    needsResponse: true,
    hasDeadline: false,
    isBlocking: false,
    canWait: true,
    shouldDraftReply: true,
    draftSubject: "Re: Quick question",
    draftBody: "Draft body",
    notifyNow: false,
    ...overrides,
  };
}

afterEach(async () => {
  const item = await prisma.attentionItem.findUnique({
    where: {
      source_sourceId: { source: "email", sourceId: SOURCE_ID },
    },
  });
  if (item) {
    await prisma.attentionAction.deleteMany({
      where: { attentionItemId: item.id },
    });
    await prisma.attentionItem.delete({ where: { id: item.id } });
  }
});

describe("attention snooze", () => {
  it("sets snoozed status and ~1h wake time", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    const before = Date.now();
    const updated = await snoozeAttentionItem(created);
    const after = Date.now();

    expect(updated.status).toBe("snoozed");
    expect(updated.snoozedUntil).toBeTruthy();
    const wake = updated.snoozedUntil!.getTime();
    expect(wake).toBeGreaterThanOrEqual(before + ATTENTION_SNOOZE_MS - 50);
    expect(wake).toBeLessThanOrEqual(after + ATTENTION_SNOOZE_MS + 50);

    const action = await prisma.attentionAction.findFirst({
      where: { attentionItemId: created.id, action: "snoozed" },
    });
    expect(action).toBeTruthy();

    const open = await listOpenAttentionItems();
    expect(open.some((i) => i.id === created.id)).toBe(false);
  });

  it("wakes expired snoozes back to open", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    await snoozeAttentionItem(created);
    await prisma.attentionItem.update({
      where: { id: created.id },
      data: { snoozedUntil: new Date(Date.now() - 1000) },
    });

    const woken = await wakeExpiredSnoozes();
    expect(woken).toBe(1);

    const row = await prisma.attentionItem.findUnique({
      where: { id: created.id },
    });
    expect(row?.status).toBe("open");
    expect(row?.snoozedUntil).toBeNull();

    const open = await listOpenAttentionItems();
    expect(open.some((i) => i.id === created.id)).toBe(true);
  });

  it("does not reopen an active snooze on rescan", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    await snoozeAttentionItem(created);

    const [rescanned] = await upsertClassifiedItems([
      baseItem({
        summary: "Rescan wants to reopen",
        draftBody: "Should not apply while snoozed",
      }),
    ]);

    expect(rescanned.status).toBe("snoozed");
    const row = await prisma.attentionItem.findUnique({
      where: { id: created.id },
    });
    expect(row?.status).toBe("snoozed");
    expect(row?.summary).toBe("Needs a reply later");
    expect(row?.draftBody).toBe("Draft body");
  });

  it("wakes an expired snooze during upsert then updates content", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    await snoozeAttentionItem(created);
    await prisma.attentionItem.update({
      where: { id: created.id },
      data: { snoozedUntil: new Date(Date.now() - 1000) },
    });

    const [rescanned] = await upsertClassifiedItems([
      baseItem({
        summary: "Updated after wake",
        draftBody: "Fresh draft",
      }),
    ]);

    expect(rescanned.status).toBe("open");
    expect(rescanned.summary).toBe("Updated after wake");
    expect(rescanned.draftBody).toBe("Fresh draft");
    expect(rescanned.snoozedUntil).toBeNull();
  });

  it("mark all done does not resolve expired-but-still-snoozed items", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    await snoozeAttentionItem(created);
    await prisma.attentionItem.update({
      where: { id: created.id },
      data: { snoozedUntil: new Date(Date.now() - 1000) },
    });

    await markAllAttentionDone();

    const row = await prisma.attentionItem.findUnique({
      where: { id: created.id },
    });
    expect(row?.status).toBe("snoozed");
    expect(row?.snoozedUntil).toBeTruthy();
  });
});
