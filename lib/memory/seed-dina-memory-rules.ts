import { createOrCorrectMemory } from "@/lib/memory/store";
import type { MemoryCategory, MemoryImportance } from "@/lib/memory/types";
import { logger } from "@/lib/logger";

type Seed = {
  category: MemoryCategory;
  title: string;
  content: string;
  importance?: MemoryImportance;
  confidence?: number;
};

const SEEDS: Seed[] = [
  {
    category: "decisions",
    title: "Memory purpose",
    content:
      "Memory exists to improve judgment, continuity, and decision making. It is not a transcript, database dump, or chat history. Ask: will knowing this in six months help serve Derek better? If no, it should not become memory.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "decisions",
    title: "What should become memory",
    content:
      "Store durable knowledge: Derek preferences/style/values/authority/routines/goals/health/church/family; people roles and relationships; project mission/decisions/direction/architecture/lessons/blockers/success; commitments beyond a single day; preferences that evolve only with evidence. Do not store every email, conversation, or commit.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "decisions",
    title: "What should not become memory",
    content:
      "Do not store temporary debugging, one-time troubleshooting, random brainstorming, every chat message or AI response, temporary emotions, quickly expiring info, duplicates, binding presentation/behavior rules (those are standing instructions), credentials, passwords, API keys, or recovery codes.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "decisions",
    title: "Memory confidence and evidence",
    content:
      "Every memory has confidence: Confirmed, High, Medium, or Low. Low-confidence memories must never silently drive important decisions. Every memory records origin (explicit statement, approval, repeated observation, connected service, imported document, inference). Inference is never equal to fact.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "decisions",
    title: "Memory approval policy",
    content:
      "Automatic: safe facts (e.g. Adam is CEO of 4StudentLives; Beacon is an active project). Approval required before permanent: identity, values, preferences, authority, health, family, finances, and other foundational memories. Ask Derek to approve before promoting those.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "decisions",
    title: "Memory hierarchy",
    content:
      "When sources disagree, trust: (1) live connected services, (2) Derek's explicit statements, (3) approved structured memory, (4) recent repeated observations, (5) historical memory, (6) inference. Never let old memory override current evidence.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "decisions",
    title: "Memory final principle",
    content:
      "Memory should make Derek feel understood, not watched. The best memories are ones Derek forgets Dina even has because they quietly make every conversation more helpful. Forgetting is a feature — archive obsolete or replaced memories.",
    importance: "critical",
    confidence: 1,
  },
];

let seeded = false;

export async function seedDinaMemoryRuleMemories(): Promise<number> {
  if (seeded) return 0;
  let count = 0;
  for (const seed of SEEDS) {
    await createOrCorrectMemory({
      category: seed.category,
      title: seed.title,
      content: seed.content,
      source: "dina_memory_rules",
      confidence: seed.confidence ?? 1,
      importance: seed.importance ?? "critical",
    });
    count += 1;
  }
  seeded = true;
  logger.info("dina_memory_rules_seeded", { count });
  return count;
}
