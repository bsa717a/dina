import { prisma } from "@/lib/db/client";
import { confidenceLabel } from "@/lib/memory/policy";
import { toMemoryRecord, touchMemoryAccess } from "@/lib/memory/store";
import type { MemoryRecord } from "@/lib/memory/types";

/**
 * Retrieve relevant active memories for a query.
 * Today: keyword / token overlap on searchText.
 * Future: swap scoring for embeddings using embeddingRef without changing MemoryItem shape.
 */
export async function retrieveRelevantMemories(
  query: string,
  options?: { limit?: number; categories?: string[] },
): Promise<MemoryRecord[]> {
  const limit = Math.min(Math.max(options?.limit ?? 12, 1), 50);
  const tokens = tokenize(query);
  if (!tokens.length) {
    const recent = await prisma.memoryItem.findMany({
      where: {
        status: "active",
        ...(options?.categories?.length
          ? { category: { in: options.categories } }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    const records = recent.map(toMemoryRecord);
    await touchMemoryAccess(records.map((r) => r.id));
    return records;
  }

  const candidates = await prisma.memoryItem.findMany({
    where: {
      status: "active",
      ...(options?.categories?.length
        ? { category: { in: options.categories } }
        : {}),
    },
    take: 400,
    orderBy: { updatedAt: "desc" },
  });

  const scored = candidates
    .map((row) => {
      const hay = row.searchText || `${row.title} ${row.content}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (hay.includes(token)) score += 1;
        if (row.title.toLowerCase().includes(token)) score += 1.5;
      }
      const importanceBoost =
        row.importance === "critical"
          ? 2
          : row.importance === "high"
            ? 1.25
            : row.importance === "low"
              ? -0.25
              : 0;
      return { row, score: score + importanceBoost + row.confidence };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const records = scored.map((item) => toMemoryRecord(item.row));
  await touchMemoryAccess(records.map((r) => r.id));
  return records;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 24);
}

/** Format memories for injection into the model system/runtime prompt. */
export function formatMemoriesForPrompt(memories: MemoryRecord[]): string {
  if (!memories.length) return "";
  const lines = memories.map((m) => {
    const label = confidenceLabel(m.confidence);
    return `- [${m.category}] ${m.title}: ${m.content} (confidence ${label}, id=${m.id})`;
  });
  return [
    "STRUCTURED MEMORY (long-term knowledge — not chat history):",
    "Use this as durable understanding of Derek. Prefer correcting existing memories (by id) over inventing duplicates.",
    "Low-confidence memories must never silently drive important decisions. Prefer live services and Derek's explicit statements over old memory.",
    ...lines,
  ].join("\n");
}
