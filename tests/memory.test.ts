import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  formatMemoriesForPrompt,
  retrieveRelevantMemories,
} from "@/lib/memory/retrieve";
import {
  approveMemory,
  archiveMemory,
  createOrCorrectMemory,
  mergeMemories,
} from "@/lib/memory/store";
import { confidenceLabel } from "@/lib/memory/policy";
import { MEMORY_CATEGORIES } from "@/lib/memory/types";

afterEach(async () => {
  await prisma.memoryItem.deleteMany({
    where: {
      source: { in: ["test", "correction", "chat", "derek_approved"] },
    },
  });
});

describe("Memory System", () => {
  it("has the twelve top-level memory domains", () => {
    expect(MEMORY_CATEGORIES).toEqual([
      "derek_profile",
      "values",
      "communication_style",
      "preferences",
      "family",
      "church",
      "health",
      "people",
      "projects",
      "commitments",
      "decisions",
      "learned_preferences",
    ]);
  });

  it("creates memories with confidence and corrects instead of duplicating by title", async () => {
    const first = await createOrCorrectMemory({
      category: "communication_style",
      title: "Response length",
      content: "Derek prefers concise responses.",
      source: "test",
      confidence: 0.8,
      importance: "high",
    });
    expect(first.confidence).toBe(0.8);
    expect(first.embeddingStatus).toBe("pending");

    const second = await createOrCorrectMemory({
      category: "communication_style",
      title: "Response length",
      content: "Derek prefers concise responses and bullets when useful.",
      source: "test",
      confidence: 0.9,
    });
    expect(second.id).toBe(first.id);
    expect(second.content).toMatch(/bullets/);
    expect(second.confidence).toBe(0.9);
  });

  it("corrects an existing memory by id", async () => {
    const created = await createOrCorrectMemory({
      category: "people",
      title: "Adam",
      content: "Adam works at 4StudentLives.",
      source: "test",
      confidence: 0.6,
    });
    const corrected = await createOrCorrectMemory({
      category: "people",
      title: "Adam",
      content: "Adam is CEO of 4StudentLives.",
      source: "test",
      confidence: 0.95,
      correctId: created.id,
    });
    expect(corrected.id).toBe(created.id);
    expect(corrected.content).toMatch(/CEO/);
    expect(corrected.source).toBe("test");
  });

  it("retrieves relevant memories and archives outdated ones", async () => {
    await createOrCorrectMemory({
      category: "projects",
      title: "Beacon",
      content: "Beacon is Derek’s security-monitoring project.",
      source: "test",
      confidence: 0.9,
      importance: "high",
    });
    await createOrCorrectMemory({
      category: "preferences",
      title: "Approvals",
      content:
        "Derek trusts recommendations but wants approval before actions.",
      source: "test",
      confidence: 0.85,
    });

    const found = await retrieveRelevantMemories("What is Beacon?");
    expect(found.some((m) => m.title === "Beacon")).toBe(true);
    expect(formatMemoriesForPrompt(found)).toMatch(/STRUCTURED MEMORY/);

    const beacon = found.find((m) => m.title === "Beacon");
    if (!beacon) throw new Error("missing beacon");
    const archived = await archiveMemory(beacon.id);
    expect(archived.status).toBe("archived");
  });

  it("stores foundational chat memories as pending until approved", async () => {
    const pending = await createOrCorrectMemory({
      category: "preferences",
      title: "Morning planning",
      content: "Derek appears to prefer morning planning.",
      source: "chat",
      confidence: 0.6,
    });
    expect(pending.status).toBe("pending_approval");
    expect(confidenceLabel(pending.confidence)).toBe("Medium");

    const found = await retrieveRelevantMemories("morning planning");
    expect(found.some((m) => m.id === pending.id)).toBe(false);

    const approved = await approveMemory(pending.id);
    expect(approved.status).toBe("active");
    expect(approved.source).toBe("derek_approved");
  });

  it("merges duplicate memories into a survivor", async () => {
    const a = await createOrCorrectMemory({
      category: "projects",
      title: "Beacon A",
      content: "Security monitoring",
      source: "test",
      confidence: 0.7,
    });
    const b = await createOrCorrectMemory({
      category: "projects",
      title: "Beacon B",
      content: "Ops monitoring platform",
      source: "test",
      confidence: 0.7,
    });
    const merged = await mergeMemories({
      survivorId: a.id,
      mergeIds: [b.id],
      title: "Beacon",
      content: "Beacon is Derek’s security-monitoring project.",
      confidence: 0.95,
    });
    expect(merged.title).toBe("Beacon");
    const loser = await prisma.memoryItem.findUnique({ where: { id: b.id } });
    expect(loser?.status).toBe("merged");
    expect(loser?.mergedIntoId).toBe(a.id);
  });
});
