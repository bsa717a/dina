import { prisma } from "@/lib/db/client";

export type AttentionBlockKind = "sender" | "domain";

export type AttentionBlockRecord = {
  id: string;
  kind: AttentionBlockKind;
  value: string;
  reason: string | null;
  source: string | null;
  createdAt: Date;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

/** Parse "user@domain", "@domain", or "domain.com" into a block target. */
export function parseAttentionBlockTarget(raw: string): {
  kind: AttentionBlockKind;
  value: string;
} | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.startsWith("@")) {
    const domain = normalizeDomain(trimmed);
    if (!domain.includes(".")) return null;
    return { kind: "domain", value: domain };
  }

  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    const at = email.lastIndexOf("@");
    if (at <= 0 || at === email.length - 1) return null;
    return { kind: "sender", value: email };
  }

  // Bare domain
  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return { kind: "domain", value: normalizeDomain(trimmed) };
  }

  return null;
}

export function addressMatchesBlocks(
  fromAddress: string | null | undefined,
  blocks: Array<{ kind: string; value: string }>,
): { blocked: boolean; reason: string | null } {
  const email = normalizeEmail(fromAddress || "");
  if (!email || !email.includes("@")) {
    return { blocked: false, reason: null };
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);

  for (const block of blocks) {
    if (block.kind === "sender" && block.value === email) {
      return { blocked: true, reason: `attention_block:sender:${block.value}` };
    }
    if (block.kind === "domain") {
      const blockedDomain = normalizeDomain(block.value);
      if (
        domain === blockedDomain ||
        domain.endsWith(`.${blockedDomain}`)
      ) {
        return {
          blocked: true,
          reason: `attention_block:domain:${blockedDomain}`,
        };
      }
    }
  }
  return { blocked: false, reason: null };
}

export async function listAttentionBlocks(): Promise<AttentionBlockRecord[]> {
  const rows = await prisma.attentionBlock.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as AttentionBlockKind,
    value: row.value,
    reason: row.reason,
    source: row.source,
    createdAt: row.createdAt,
  }));
}

export async function isAddressBlocked(
  fromAddress: string | null | undefined,
): Promise<{ blocked: boolean; reason: string | null }> {
  const blocks = await listAttentionBlocks();
  return addressMatchesBlocks(fromAddress, blocks);
}

export async function createAttentionBlock(input: {
  target: string;
  reason?: string | null;
  source?: string | null;
}): Promise<AttentionBlockRecord> {
  const parsed = parseAttentionBlockTarget(input.target);
  if (!parsed) {
    throw new Error(
      'Invalid block target. Use an email (a@b.com) or domain (@b.com).',
    );
  }

  const row = await prisma.attentionBlock.upsert({
    where: {
      kind_value: { kind: parsed.kind, value: parsed.value },
    },
    create: {
      kind: parsed.kind,
      value: parsed.value,
      reason: input.reason?.trim() || null,
      source: input.source?.trim() || null,
    },
    update: {
      reason: input.reason?.trim() || null,
      source: input.source?.trim() || null,
    },
  });

  return {
    id: row.id,
    kind: row.kind as AttentionBlockKind,
    value: row.value,
    reason: row.reason,
    source: row.source,
    createdAt: row.createdAt,
  };
}

export async function deleteAttentionBlock(target: string): Promise<boolean> {
  const parsed = parseAttentionBlockTarget(target);
  if (!parsed) return false;
  try {
    await prisma.attentionBlock.delete({
      where: { kind_value: { kind: parsed.kind, value: parsed.value } },
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteAttentionBlockById(id: string): Promise<boolean> {
  try {
    await prisma.attentionBlock.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

/** Partition items that have fromAddress into blocked vs not. */
export function partitionByAttentionBlocks<
  T extends { fromAddress?: string | null },
>(items: T[], blocks: Array<{ kind: string; value: string }>) {
  const blocked: Array<T & { blockReason: string }> = [];
  const allowed: T[] = [];
  for (const item of items) {
    const match = addressMatchesBlocks(item.fromAddress, blocks);
    if (match.blocked && match.reason) {
      blocked.push({ ...item, blockReason: match.reason });
    } else {
      allowed.push(item);
    }
  }
  return { blocked, allowed };
}
