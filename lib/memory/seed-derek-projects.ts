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
    category: "projects",
    title: "Project philosophy",
    content:
      "Projects are the primary unit of work. Emails, meetings, GitHub activity, documents, calendar events, AI agents, and conversations all exist in service of a project. Always attempt to associate new information with an existing project before creating a new one. Projects are living entities with purpose, momentum, blockers, history, people, and desired outcomes. The goal is not to manage tasks — it is to understand progress.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "projects",
    title: "Project rules",
    content:
      "Do not require manual status updates whenever possible. Infer progress from Microsoft 365, GitHub, conversations, documents, calendar, and future integrations. When uncertain, ask Derek rather than guessing. The purpose of projects is helping Derek know where meaningful progress can be made next — not reporting.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "projects",
    title: "New project template",
    content:
      "When a new project is created, store: Mission; Desired outcome; Why it matters; Current phase; Priority; Key people; Important decisions; Current blockers; Waiting on Derek; Waiting on others; GitHub repositories; Related documents; Related conversations; Active AI agents; Last meaningful progress; Definition of success.",
    importance: "high",
    confidence: 1,
  },
  {
    category: "projects",
    title: "Dina",
    content:
      "Build an AI Chief of Staff that meaningfully reduces Derek's mental overhead and becomes his trusted operating system for work and life. Success: Derek naturally starts and ends each day with Dina; she proactively monitors work, prepares decisions, protects focus, and continuously improves through experience. Current phase: Foundation — building core architecture before advanced intelligence. Current priorities: Conversation interface; Chief of Staff Engine; Memory; Microsoft 365; GitHub; Attention Engine.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "projects",
    title: "Beacon",
    content:
      "Provide continuous visibility into Derek's software projects, infrastructure, and AI agents so nothing important is overlooked. Success: Beacon quietly watches systems and only interrupts when something genuinely deserves attention. Typical signals: GitHub workflows; Agent completion; Security events; Deployment status. Related GitHub: 4StudentLives/beacon (and personal tooling as relevant).",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "projects",
    title: "4StudentLives",
    content:
      "Help schools identify, assess, and manage student safety concerns with a platform that is intuitive, reliable, and genuinely improves outcomes. Success: Districts spend less time managing software and more time helping students. Guiding principles: Simplicity; Mobile-first; Fast workflows; Reliable documentation; AI should reduce work, not add it.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "projects",
    title: "MetabolicOS",
    content:
      "Help people build sustainable health habits through intelligent coaching rather than rigid tracking. Success: Users consistently improve their health because the software makes healthy decisions easier. Guiding principles: Reduce friction; Encourage consistency; Coach rather than judge; Make complexity invisible. Related personal GitHub: bsa717a/metabolic.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "projects",
    title: "Hidden Guardians",
    content:
      "Write stories that inspire courage, sacrifice, faith, and purpose. Success: Readers become emotionally invested in the characters and leave with hope.",
    importance: "normal",
    confidence: 0.95,
  },
  {
    category: "projects",
    title: "ClifsMama",
    content:
      "Serve as a legitimate business presence and future home for selected software and business initiatives.",
    importance: "normal",
    confidence: 0.9,
  },
];

let seeded = false;

export async function seedDerekProjectMemories(): Promise<number> {
  if (seeded) return 0;
  let count = 0;
  for (const seed of SEEDS) {
    await createOrCorrectMemory({
      category: seed.category,
      title: seed.title,
      content: seed.content,
      source: "derek_projects",
      confidence: seed.confidence ?? 0.95,
      importance: seed.importance ?? "high",
    });
    count += 1;
  }
  seeded = true;
  logger.info("derek_project_memories_seeded", { count });
  return count;
}
