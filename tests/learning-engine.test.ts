import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { heuristicLessonFromSignal } from "@/lib/learning/heuristics";
import {
  formatLessonsForPrompt,
  listActiveLessons,
  persistLesson,
} from "@/lib/learning/lessons";
import { distillLessonFromSignal } from "@/lib/learning/distill";

afterEach(async () => {
  await prisma.memoryItem.deleteMany({
    where: {
      source: { in: ["derek_feedback", "learning_engine", "test"] },
      title: {
        in: [
          "Recommendation format",
          "Response length",
          "Always lead with the decision",
        ],
      },
    },
  });
});

describe("Learning Engine heuristics", () => {
  it("learns one-option preference from an explicit revise note", () => {
    const lesson = heuristicLessonFromSignal({
      action: "revise_draft",
      note: "Prefer one recommended option instead of five.",
    });
    expect(lesson).toMatchObject({
      category: "learned_preferences",
      title: "Recommendation format",
      source: "derek_feedback",
    });
    expect(lesson?.content).toMatch(/one recommended option/i);
  });

  it("learns brevity from a revise note", () => {
    const lesson = heuristicLessonFromSignal({
      action: "revise_draft",
      note: "Keep it shorter please",
    });
    expect(lesson?.title).toBe("Response length");
    expect(lesson?.source).toBe("derek_feedback");
  });

  it("captures always/never notes as lessons", () => {
    const lesson = heuristicLessonFromSignal({
      action: "revise_draft",
      note: "Always lead with the decision",
    });
    expect(lesson?.content).toMatch(/Always lead with the decision/i);
    expect(lesson?.source).toBe("derek_feedback");
  });

  it("returns null for weak signals", () => {
    expect(
      heuristicLessonFromSignal({
        action: "accepted_recommendation",
      }),
    ).toBeNull();
  });
});

describe("Learning Engine persistence", () => {
  it("persists and formats active lessons for prompts", async () => {
    const lesson = await distillLessonFromSignal({
      action: "revise_draft",
      note: "I prefer one recommended option, not five.",
    });
    expect(lesson).not.toBeNull();
    const saved = await persistLesson(lesson!);
    expect(saved?.status).toBe("active");
    expect(saved?.source).toBe("derek_feedback");

    const active = await listActiveLessons();
    expect(active.some((m) => m.title === "Recommendation format")).toBe(true);
    expect(formatLessonsForPrompt(active)).toMatch(/LEARNED PREFERENCES/);
    expect(formatLessonsForPrompt(active)).toMatch(/one recommended option/i);
  });

  it("dedupes by title on re-learn", async () => {
    const first = await persistLesson({
      category: "learned_preferences",
      title: "Recommendation format",
      content: "Prefer one recommended option.",
      confidence: 0.9,
      source: "derek_feedback",
    });
    const second = await persistLesson({
      category: "learned_preferences",
      title: "Recommendation format",
      content:
        "Prefer one recommended option instead of a list of multiple alternatives.",
      confidence: 0.95,
      source: "derek_feedback",
    });
    expect(second?.id).toBe(first?.id);
    const count = await prisma.memoryItem.count({
      where: {
        category: "learned_preferences",
        title: "Recommendation format",
        status: { in: ["active", "pending_approval"] },
      },
    });
    expect(count).toBe(1);
  });
});
