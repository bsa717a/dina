import type { AuthUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db/client";
import {
  DEFAULT_OWNER_SECTIONS,
  normalizeSectionIds,
  type MorningBriefSectionId,
} from "@/lib/morning-ritual/sections";

export type MorningBriefPrefStatus = "ready" | "pending";
export type MorningBriefPendingReason = "generate" | "setup";

export type MorningBriefPreference = {
  userId: string;
  sections: MorningBriefSectionId[];
  status: MorningBriefPrefStatus;
  pendingReason: MorningBriefPendingReason | null;
};

function parseSections(raw: string): MorningBriefSectionId[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? normalizeSectionIds(parsed.filter((value): value is string => typeof value === "string"))
      : [];
  } catch {
    return [];
  }
}

function toPref(row: {
  userId: string;
  sectionsJson: string;
  status: string;
  pendingReason: string | null;
}): MorningBriefPreference {
  return {
    userId: row.userId,
    sections: parseSections(row.sectionsJson),
    status: row.status === "pending" ? "pending" : "ready",
    pendingReason:
      row.pendingReason === "generate" || row.pendingReason === "setup"
        ? row.pendingReason
        : null,
  };
}

export async function getMorningBriefPreference(
  userId: string,
): Promise<MorningBriefPreference | null> {
  const row = await prisma.morningBriefPreference.findUnique({
    where: { userId },
  });
  return row ? toPref(row) : null;
}

export function defaultSectionsForUser(
  user: Pick<AuthUser, "role">,
): MorningBriefSectionId[] {
  return user.role === "owner" ? [...DEFAULT_OWNER_SECTIONS] : [];
}

export function effectiveSections(
  user: Pick<AuthUser, "role">,
  pref: MorningBriefPreference | null,
): MorningBriefSectionId[] {
  if (pref?.sections.length) return pref.sections;
  return defaultSectionsForUser(user);
}

export function needsMorningBriefSetup(
  user: Pick<AuthUser, "role">,
  pref: MorningBriefPreference | null,
): boolean {
  if (pref?.sections.length) return false;
  if (pref?.status === "pending") return true;
  return user.role !== "owner";
}

export async function markMorningBriefSetupPending(input: {
  userId: string;
  reason: MorningBriefPendingReason;
  sections?: MorningBriefSectionId[];
}): Promise<MorningBriefPreference> {
  const existing = await getMorningBriefPreference(input.userId);
  const sections = input.sections ?? existing?.sections ?? [];
  const row = await prisma.morningBriefPreference.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      sectionsJson: JSON.stringify(sections),
      status: "pending",
      pendingReason: input.reason,
    },
    update: {
      status: "pending",
      pendingReason: input.reason,
      ...(input.sections ? { sectionsJson: JSON.stringify(input.sections) } : {}),
    },
  });
  return toPref(row);
}

export async function saveMorningBriefSections(input: {
  userId: string;
  sections: MorningBriefSectionId[];
}): Promise<MorningBriefPreference> {
  const sections = normalizeSectionIds(input.sections);
  const row = await prisma.morningBriefPreference.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      sectionsJson: JSON.stringify(sections),
      status: "ready",
      pendingReason: null,
    },
    update: {
      sectionsJson: JSON.stringify(sections),
      status: "ready",
      pendingReason: null,
    },
  });
  return toPref(row);
}

export async function clearMorningBriefPending(
  userId: string,
): Promise<MorningBriefPreference | null> {
  const existing = await getMorningBriefPreference(userId);
  if (!existing) return null;
  const row = await prisma.morningBriefPreference.update({
    where: { userId },
    data: { status: "ready", pendingReason: null },
  });
  return toPref(row);
}
