import { logger } from "@/lib/logger";
import { setStandingInstruction } from "@/lib/standing-instructions/store";
import { prisma } from "@/lib/db/client";

const SEEDS = [
  {
    title: "Never show task IDs",
    content:
      "Never show project task IDs, UUIDs, or internal database keys to Derek. Recite remaining tasks as numbered titles only (1. Title). When confirming add, complete, or update, use the number and title. Tools may return extra fields for your own use — do not repeat an id.",
  },
];

let seeded = false;

/** Create default standing instructions if missing. Never overwrites or un-archives. */
export async function seedStandingInstructions(): Promise<number> {
  if (seeded) return 0;
  let count = 0;
  for (const seed of SEEDS) {
    const existing = await prisma.standingInstruction.findUnique({
      where: { title: seed.title },
    });
    if (existing) continue;
    await setStandingInstruction({
      title: seed.title,
      content: seed.content,
      source: "seed",
    });
    count += 1;
  }
  seeded = true;
  logger.info("standing_instructions_seeded", { count });
  return count;
}

export function resetStandingInstructionSeedGate() {
  seeded = false;
}
