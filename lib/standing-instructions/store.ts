import { prisma } from "@/lib/db/client";
import {
  MAX_ACTIVE_STANDING_INSTRUCTIONS,
  STANDING_INSTRUCTION_STATUSES,
  type StandingInstructionRecord,
  type StandingInstructionStatus,
} from "@/lib/standing-instructions/types";

function asStatus(value: string): StandingInstructionStatus {
  if (
    STANDING_INSTRUCTION_STATUSES.includes(value as StandingInstructionStatus)
  ) {
    return value as StandingInstructionStatus;
  }
  return "active";
}

async function assertActiveStandingInstructionCapacity() {
  const activeCount = await prisma.standingInstruction.count({
    where: { status: "active" },
  });
  if (activeCount >= MAX_ACTIVE_STANDING_INSTRUCTIONS) {
    throw new Error(
      `At most ${MAX_ACTIVE_STANDING_INSTRUCTIONS} standing instructions. Archive one first.`,
    );
  }
}

function toRecord(row: {
  id: string;
  title: string;
  content: string;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}): StandingInstructionRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: asStatus(row.status),
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listStandingInstructions(options?: {
  status?: StandingInstructionStatus;
}): Promise<StandingInstructionRecord[]> {
  const rows = await prisma.standingInstruction.findMany({
    where: options?.status ? { status: options.status } : undefined,
    orderBy: [{ updatedAt: "desc" }],
  });
  return rows.map(toRecord);
}

export async function listActiveStandingInstructions() {
  return listStandingInstructions({ status: "active" });
}

export async function getStandingInstruction(idOrTitle: string) {
  const trimmed = idOrTitle.trim();
  const row = await prisma.standingInstruction.findFirst({
    where: {
      OR: [{ id: trimmed }, { title: trimmed }],
    },
  });
  return row ? toRecord(row) : null;
}

/**
 * Create or update by title. Reactivates an archived row with the same title.
 * Does not create a duplicate.
 */
export async function setStandingInstruction(input: {
  title: string;
  content: string;
  source?: string;
}): Promise<StandingInstructionRecord> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error("Standing instruction title is required.");
  if (!content) throw new Error("Standing instruction content is required.");

  const existing = await prisma.standingInstruction.findUnique({
    where: { title },
  });

  if (existing) {
    if (existing.status !== "active") {
      await assertActiveStandingInstructionCapacity();
    }
    const row = await prisma.standingInstruction.update({
      where: { id: existing.id },
      data: {
        content,
        status: "active",
        source: input.source || existing.source,
      },
    });
    return toRecord(row);
  }

  await assertActiveStandingInstructionCapacity();

  const row = await prisma.standingInstruction.create({
    data: {
      title,
      content,
      source: input.source || "chat",
    },
  });
  return toRecord(row);
}

export async function archiveStandingInstruction(idOrTitle: string) {
  const existing = await getStandingInstruction(idOrTitle);
  if (!existing) throw new Error("Standing instruction not found.");
  const row = await prisma.standingInstruction.update({
    where: { id: existing.id },
    data: { status: "archived" },
  });
  return toRecord(row);
}
