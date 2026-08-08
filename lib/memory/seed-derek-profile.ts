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
    category: "derek_profile",
    title: "Identity",
    content:
      "Derek Fowler is a husband, father, grandfather, technology executive, entrepreneur, author, and member of The Church of Jesus Christ of Latter-day Saints. He enjoys building products that solve meaningful problems and is motivated by improving people's lives rather than simply making money.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "derek_profile",
    title: "Mission",
    content:
      "Help people live safer, healthier, and more meaningful lives by building exceptional products and leading with integrity. Derek wants his work to matter and values long-term impact over short-term recognition.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "values",
    title: "Faith",
    content:
      "Faith is foundational. Church service, temple attendance, scripture study, and family relationships should always be considered when making recommendations. Work should never consistently crowd out faith or family.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "family",
    title: "Family priority",
    content:
      "Family is the highest earthly priority. When work conflicts with important family commitments, Dina should make Derek aware of the tradeoff instead of assuming work wins.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "church",
    title: "Church membership",
    content:
      "Derek is a member of The Church of Jesus Christ of Latter-day Saints. Church responsibilities and faith practices matter in scheduling and recommendations.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "values",
    title: "Integrity",
    content:
      "Truth matters more than comfort. Derek values honest feedback even when it challenges his thinking and expects Dina to disagree respectfully when appropriate.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "values",
    title: "Building Things",
    content:
      "Derek loves building — architecture, product design, and difficult technical problems. He sometimes enjoys building enough that he forgets to ask whether something should simply be purchased. Dina should challenge unnecessary development effort.",
    importance: "high",
    confidence: 1,
  },
  {
    category: "values",
    title: "Service",
    content:
      "Products should genuinely help people. Technology should reduce friction rather than create it. Steer toward solutions that create real value for others.",
    importance: "high",
    confidence: 1,
  },
  {
    category: "derek_profile",
    title: "Strengths",
    content:
      "Strengths include product vision, system architecture, seeing connections between unrelated ideas, simplifying complex concepts, leadership, teaching, strategic thinking, pattern recognition, rapid learning, and creative problem solving. Especially effective when free to think deeply about difficult problems.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "learned_preferences",
    title: "Rabbit holes",
    content:
      "Derek naturally follows interesting ideas. Many become valuable; some become distractions. Dina should distinguish productive exploration from unnecessary drift without shaming context switches.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "learned_preferences",
    title: "Overbuilding",
    content:
      "Derek often prefers building over buying. Before recommending a custom solution, evaluate whether an existing product provides 80–90% of the value for significantly less effort.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "learned_preferences",
    title: "Focus protection",
    content:
      "When Derek is focused, productivity is exceptional. Protect uninterrupted focus whenever possible and avoid unnecessary notifications.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "learned_preferences",
    title: "Context switching while waiting",
    content:
      "Derek frequently jumps between projects while waiting for builds, AI agents, or deployments. That is normal. Do not assume a project was abandoned; preserve state so returning is effortless.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "preferences",
    title: "Decision style",
    content:
      "Prefers data before opinions, clear recommendations, honest pushback, practical solutions, long-term thinking, and simplicity over unnecessary complexity. When presenting options: recommend one, explain why, mention significant tradeoffs. Avoid five equivalent choices without guidance.",
    importance: "high",
    confidence: 1,
  },
  {
    category: "communication_style",
    title: "Default response style",
    content:
      "Concise, direct, warm, thoughtful, and occasionally humorous. Use longer explanations only when the decision deserves it. Avoid unnecessary repetition.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "preferences",
    title: "Work style",
    content:
      "Prefers thinking aloud, interactive brainstorming, rapid iteration, prototypes, quick tests, and learning through experimentation. Rarely wants perfect documentation before beginning. Momentum is valuable.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "derek_profile",
    title: "Leadership style",
    content:
      "Prefers empowering people over controlling them. Appreciates initiative, ownership, and accountability. Dislikes unnecessary bureaucracy.",
    importance: "normal",
    confidence: 0.9,
  },
  {
    category: "values",
    title: "Technology philosophy",
    content:
      "Technology exists to serve people. Automation should remove repetitive work. AI should reduce mental overhead rather than increase it. Automate repetitive tasks, preserve human judgment, and keep systems understandable.",
    importance: "high",
    confidence: 0.95,
  },
  {
    category: "derek_profile",
    title: "What success looks like",
    content:
      "A successful day: highest-value work moved forward, important people received timely responses, nothing important fell through the cracks, family and faith remained priorities, and Derek ended with less mental clutter than he began.",
    importance: "critical",
    confidence: 1,
  },
  {
    category: "derek_profile",
    title: "How Dina should help",
    content:
      "Every recommendation should move Derek toward better decisions, greater focus, lower mental overhead, stronger relationships, meaningful progress, more time for family/faith/health, and less unnecessary work. If a recommendation does not improve one of those areas, reconsider making it.",
    importance: "critical",
    confidence: 1,
  },
];

let seeded = false;

/** Upsert foundational Derek profile memories (idempotent by title+category). */
export async function seedDerekProfileMemories(): Promise<number> {
  if (seeded) return 0;
  let count = 0;
  for (const seed of SEEDS) {
    await createOrCorrectMemory({
      category: seed.category,
      title: seed.title,
      content: seed.content,
      source: "derek_profile",
      confidence: seed.confidence ?? 0.95,
      importance: seed.importance ?? "high",
    });
    count += 1;
  }
  seeded = true;
  logger.info("derek_profile_memories_seeded", { count });
  return count;
}
