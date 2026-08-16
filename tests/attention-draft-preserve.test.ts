import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { upsertClassifiedItems } from "@/lib/attention/store";
import type { ClassifiedAttention } from "@/lib/attention/types";

function baseItem(
  overrides: Partial<ClassifiedAttention> = {},
): ClassifiedAttention {
  return {
    source: "email",
    sourceId: "microsoft365:email:draft-preserve-test",
    category: "reply_required",
    sender: "Adam",
    subject: "Funding",
    summary: "Needs a reply",
    whyItMatters: "Funding decision",
    recommendedAction: "Reply with recommendation",
    needsResponse: true,
    hasDeadline: false,
    isBlocking: false,
    canWait: true,
    shouldDraftReply: true,
    draftSubject: "Re: Funding",
    draftBody: "Generated draft v1",
    notifyNow: false,
    ...overrides,
  };
}

afterEach(async () => {
  const item = await prisma.attentionItem.findUnique({
    where: {
      source_sourceId: {
        source: "email",
        sourceId: "microsoft365:email:draft-preserve-test",
      },
    },
  });
  if (item) {
    await prisma.attentionAction.deleteMany({
      where: { attentionItemId: item.id },
    });
    await prisma.attentionItem.delete({ where: { id: item.id } });
  }
});

describe("attention draft preservation on rescan", () => {
  it("overwrites drafts when Derek has not edited or revised", async () => {
    await upsertClassifiedItems([baseItem()]);
    const [updated] = await upsertClassifiedItems([
      baseItem({
        draftSubject: "Re: Funding (v2)",
        draftBody: "Generated draft v2",
      }),
    ]);
    expect(updated.draftSubject).toBe("Re: Funding (v2)");
    expect(updated.draftBody).toBe("Generated draft v2");
  });

  it("keeps edited drafts across rescans", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    await prisma.attentionItem.update({
      where: { id: created.id },
      data: {
        draftSubject: "Derek's subject",
        draftBody: "Derek's carefully edited body",
      },
    });
    await prisma.attentionAction.create({
      data: {
        attentionItemId: created.id,
        action: "edited_draft",
        detailsJson: JSON.stringify({ draftBody: "Derek's carefully edited body" }),
      },
    });

    const [rescanned] = await upsertClassifiedItems([
      baseItem({
        draftSubject: "Engine wants to overwrite",
        draftBody: "Engine overwrite body",
        summary: "Updated summary from scan",
      }),
    ]);

    expect(rescanned.draftSubject).toBe("Derek's subject");
    expect(rescanned.draftBody).toBe("Derek's carefully edited body");
    expect(rescanned.summary).toBe("Updated summary from scan");
  });

  it("keeps AI-revised drafts across rescans", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    await prisma.attentionItem.update({
      where: { id: created.id },
      data: {
        draftSubject: "Revised subject",
        draftBody: "Revised body",
      },
    });
    await prisma.attentionAction.create({
      data: {
        attentionItemId: created.id,
        action: "revise_draft",
      },
    });

    const [rescanned] = await upsertClassifiedItems([
      baseItem({
        draftSubject: "Overwrite me",
        draftBody: "Overwrite body",
      }),
    ]);

    expect(rescanned.draftSubject).toBe("Revised subject");
    expect(rescanned.draftBody).toBe("Revised body");
  });

  it("keeps on-view generated drafts when a later scan has no draft copy", async () => {
    const [created] = await upsertClassifiedItems([baseItem()]);
    await prisma.attentionItem.update({
      where: { id: created.id },
      data: {
        draftSubject: "Re: Funding",
        draftBody: "Generated when Derek opened the card",
      },
    });
    await prisma.attentionAction.create({
      data: {
        attentionItemId: created.id,
        action: "generated_draft",
      },
    });

    const [rescanned] = await upsertClassifiedItems([
      baseItem({
        draftSubject: undefined,
        draftBody: undefined,
        shouldDraftReply: true,
      }),
    ]);

    expect(rescanned.draftSubject).toBe("Re: Funding");
    expect(rescanned.draftBody).toBe("Generated when Derek opened the card");
  });

  it("clears unprotected scan-era drafts when the engine no longer wants a reply", async () => {
    await upsertClassifiedItems([baseItem()]);
    const [rescanned] = await upsertClassifiedItems([
      baseItem({
        draftSubject: undefined,
        draftBody: undefined,
        shouldDraftReply: false,
      }),
    ]);
    expect(rescanned.shouldDraftReply).toBe(false);
    expect(rescanned.draftSubject).toBeNull();
    expect(rescanned.draftBody).toBeNull();
  });
});
