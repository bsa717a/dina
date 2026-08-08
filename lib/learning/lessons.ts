import { prisma } from "@/lib/db/client";
import { createOrCorrectMemory, toMemoryRecord } from "@/lib/memory/store";
import type { MemoryRecord } from "@/lib/memory/types";
import type { LessonCandidate } from "@/lib/learning/types";
import { logger } from "@/lib/logger";

/** Active lessons that should steer CoS / revise / chat. */
export async function listActiveLessons(limit = 24): Promise<MemoryRecord[]> {
  const rows = await prisma.memoryItem.findMany({
    where: {
      status: "active",
      category: { in: ["learned_preferences", "decisions"] },
    },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });
  return rows.map(toMemoryRecord);
}

export function formatLessonsForPrompt(lessons: MemoryRecord[]): string {
  if (!lessons.length) return "";
  const lines = lessons.map((m) => `- ${m.title}: ${m.content}`);
  return [
    "LEARNED PREFERENCES (apply unless Derek contradicts in this turn):",
    "These came from Derek’s decisions and corrections. Prefer one clear recommendation when the lessons say so.",
    ...lines,
  ].join("\n");
}

export async function persistLesson(
  lesson: LessonCandidate,
): Promise<MemoryRecord | null> {
  try {
    const memory = await createOrCorrectMemory({
      category: lesson.category,
      title: lesson.title,
      content: lesson.content,
      source: lesson.source,
      confidence: lesson.confidence,
      importance: "high",
    });
    logger.info("learning_engine_lesson_persisted", {
      id: memory.id,
      title: memory.title,
      status: memory.status,
      source: lesson.source,
    });
    return memory;
  } catch (error) {
    logger.warn("learning_engine_lesson_persist_failed", {
      title: lesson.title,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
