import { prisma } from "@/lib/db/client";
import { resolveMemoryStatus } from "@/lib/memory/policy";
import {
  buildSearchText,
  type MemoryCategory,
  type MemoryImportance,
  type MemoryInput,
  type MemoryRecord,
} from "@/lib/memory/types";

function parseRelatedIds(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function toMemoryRecord(row: {
  id: string;
  category: string;
  title: string;
  content: string;
  source: string;
  confidence: number;
  importance: string;
  status: string;
  relatedIdsJson: string;
  mergedIntoId: string | null;
  embeddingStatus: string;
  embeddingModel: string | null;
  embeddingRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
}): MemoryRecord {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    importance: row.importance,
    status: row.status,
    relatedIds: parseRelatedIds(row.relatedIdsJson),
    mergedIntoId: row.mergedIntoId,
    embeddingStatus: row.embeddingStatus,
    embeddingModel: row.embeddingModel,
    embeddingRef: row.embeddingRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastAccessedAt: row.lastAccessedAt,
  };
}

function clampConfidence(value: number) {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** Create a memory, or correct an existing one when correctId is provided. */
export async function createOrCorrectMemory(
  input: MemoryInput,
): Promise<MemoryRecord> {
  const confidence = clampConfidence(input.confidence);
  const importance = input.importance || "normal";
  const relatedIds = input.relatedIds || [];
  const searchText = buildSearchText(input.title, input.content, input.category);
  const status = resolveMemoryStatus({
    category: input.category,
    source: input.source,
    correctId: input.correctId,
  });

  if (input.correctId) {
    const existing = await prisma.memoryItem.findUnique({
      where: { id: input.correctId },
    });
    if (!existing || existing.status === "merged") {
      throw new Error("Memory to correct was not found.");
    }
    const updated = await prisma.memoryItem.update({
      where: { id: existing.id },
      data: {
        category: input.category,
        title: input.title.trim(),
        content: input.content.trim(),
        source: input.source === "chat" ? "correction" : input.source,
        confidence,
        importance,
        status: "active",
        relatedIdsJson: JSON.stringify(relatedIds),
        searchText,
        embeddingStatus: "pending",
      },
    });
    return toMemoryRecord(updated);
  }

  // Prefer correcting a near-duplicate in the same category (same title).
  const duplicate = await prisma.memoryItem.findFirst({
    where: {
      status: { in: ["active", "pending_approval"] },
      category: input.category,
      title: { equals: input.title.trim() },
    },
  });
  if (duplicate) {
    const nextStatus =
      duplicate.status === "active" ? "active" : status;
    const updated = await prisma.memoryItem.update({
      where: { id: duplicate.id },
      data: {
        content: input.content.trim(),
        source: input.source,
        confidence: Math.max(duplicate.confidence, confidence),
        importance,
        status: nextStatus,
        relatedIdsJson: JSON.stringify(
          Array.from(
            new Set([...parseRelatedIds(duplicate.relatedIdsJson), ...relatedIds]),
          ),
        ),
        searchText,
        embeddingStatus: "pending",
      },
    });
    return toMemoryRecord(updated);
  }

  const created = await prisma.memoryItem.create({
    data: {
      category: input.category,
      title: input.title.trim(),
      content: input.content.trim(),
      source: input.source,
      confidence,
      importance,
      status,
      relatedIdsJson: JSON.stringify(relatedIds),
      searchText,
      embeddingStatus: "pending",
    },
  });
  return toMemoryRecord(created);
}

/** Promote a pending foundational memory after Derek approves. */
export async function approveMemory(id: string): Promise<MemoryRecord> {
  const existing = await prisma.memoryItem.findUnique({ where: { id } });
  if (!existing || existing.status === "merged") {
    throw new Error("Memory not found.");
  }
  const updated = await prisma.memoryItem.update({
    where: { id },
    data: {
      status: "active",
      source:
        existing.source === "chat" || existing.source === "chief_of_staff"
          ? "derek_approved"
          : existing.source,
    },
  });
  return toMemoryRecord(updated);
}

export async function updateMemory(
  id: string,
  patch: Partial<{
    category: MemoryCategory;
    title: string;
    content: string;
    confidence: number;
    importance: MemoryImportance;
    relatedIds: string[];
    source: string;
  }>,
): Promise<MemoryRecord> {
  const existing = await prisma.memoryItem.findUnique({ where: { id } });
  if (!existing || existing.status === "merged") {
    throw new Error("Memory not found.");
  }

  const title = patch.title?.trim() || existing.title;
  const content = patch.content?.trim() || existing.content;
  const category = patch.category || existing.category;

  const updated = await prisma.memoryItem.update({
    where: { id },
    data: {
      category,
      title,
      content,
      confidence:
        patch.confidence !== undefined
          ? clampConfidence(patch.confidence)
          : existing.confidence,
      importance: patch.importance || existing.importance,
      relatedIdsJson:
        patch.relatedIds !== undefined
          ? JSON.stringify(patch.relatedIds)
          : existing.relatedIdsJson,
      source: patch.source || existing.source,
      searchText: buildSearchText(title, content, category),
      embeddingStatus: "pending",
      status: "active",
    },
  });
  return toMemoryRecord(updated);
}

export async function archiveMemory(id: string): Promise<MemoryRecord> {
  const updated = await prisma.memoryItem.update({
    where: { id },
    data: { status: "archived" },
  });
  return toMemoryRecord(updated);
}

/**
 * Merge duplicate memories into a survivor.
 * Losers are archived as merged and point at the survivor.
 */
export async function mergeMemories(input: {
  survivorId: string;
  mergeIds: string[];
  title?: string;
  content?: string;
  confidence?: number;
}): Promise<MemoryRecord> {
  const survivor = await prisma.memoryItem.findUnique({
    where: { id: input.survivorId },
  });
  if (!survivor || survivor.status !== "active") {
    throw new Error("Survivor memory not found or not active.");
  }

  const mergeIds = input.mergeIds.filter((id) => id !== input.survivorId);
  const related = new Set(parseRelatedIds(survivor.relatedIdsJson));

  for (const id of mergeIds) {
    const row = await prisma.memoryItem.findUnique({ where: { id } });
    if (!row || row.status === "merged") continue;
    for (const relatedId of parseRelatedIds(row.relatedIdsJson)) {
      if (relatedId !== survivor.id) related.add(relatedId);
    }
    related.add(id);
    await prisma.memoryItem.update({
      where: { id },
      data: {
        status: "merged",
        mergedIntoId: survivor.id,
      },
    });
  }

  const title = input.title?.trim() || survivor.title;
  const content = input.content?.trim() || survivor.content;
  const updated = await prisma.memoryItem.update({
    where: { id: survivor.id },
    data: {
      title,
      content,
      confidence:
        input.confidence !== undefined
          ? clampConfidence(input.confidence)
          : survivor.confidence,
      relatedIdsJson: JSON.stringify([...related]),
      searchText: buildSearchText(title, content, survivor.category),
      embeddingStatus: "pending",
    },
  });
  return toMemoryRecord(updated);
}

export async function getMemory(id: string): Promise<MemoryRecord | null> {
  const row = await prisma.memoryItem.findUnique({ where: { id } });
  if (!row) return null;
  return toMemoryRecord(row);
}

export async function listMemories(options?: {
  category?: string;
  status?: string;
  limit?: number;
}): Promise<MemoryRecord[]> {
  const rows = await prisma.memoryItem.findMany({
    where: {
      status: options?.status || "active",
      ...(options?.category ? { category: options.category } : {}),
    },
    orderBy: [{ importance: "asc" }, { updatedAt: "desc" }],
    take: Math.min(Math.max(options?.limit ?? 100, 1), 500),
  });
  // importance is string; sort critical first in JS
  const rank: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  return rows
    .map(toMemoryRecord)
    .sort(
      (a, b) =>
        (rank[a.importance] ?? 9) - (rank[b.importance] ?? 9) ||
        String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
}

export async function touchMemoryAccess(ids: string[]) {
  if (!ids.length) return;
  const now = new Date();
  await prisma.memoryItem.updateMany({
    where: { id: { in: ids } },
    data: { lastAccessedAt: now },
  });
}
