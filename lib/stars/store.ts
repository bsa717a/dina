import { prisma } from "@/lib/db/client";

export const STAR_SOFT_CAP = 20;

export type StarredMessageSummary = {
  id: string;
  role: string;
  conversationId: string;
  createdAt: Date;
  starredAt: Date;
  preview: string;
  charCount: number;
};

function previewOf(content: string, max = 180) {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function ownedStarWhere(userId: string) {
  return {
    starredAt: { not: null },
    conversation: { userId },
  };
}

export async function countStarredMessages(userId: string) {
  return prisma.message.count({ where: ownedStarWhere(userId) });
}

export async function listStarredMessages(userId: string, limit = STAR_SOFT_CAP) {
  const rows = await prisma.message.findMany({
    where: ownedStarWhere(userId),
    orderBy: { starredAt: "desc" },
    take: Math.min(Math.max(limit, 1), STAR_SOFT_CAP),
  });
  return rows.map(
    (row): StarredMessageSummary => ({
      id: row.id,
      role: row.role,
      conversationId: row.conversationId,
      createdAt: row.createdAt,
      starredAt: row.starredAt!,
      preview: previewOf(row.content),
      charCount: row.content.length,
    }),
  );
}

export async function getStarredMessage(id: string, userId: string) {
  const row = await prisma.message.findFirst({
    where: { id, ...ownedStarWhere(userId) },
  });
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    starredAt: row.starredAt!,
    content: row.content,
    charCount: row.content.length,
  };
}

export async function setMessageStarred(
  id: string,
  starred: boolean,
  userId: string,
) {
  const existing = await prisma.message.findFirst({
    where: { id, conversation: { userId } },
  });
  if (!existing) {
    return { ok: false as const, error: "Message not found.", status: 404 };
  }

  if (!starred) {
    const updated = await prisma.message.update({
      where: { id },
      data: { starredAt: null },
    });
    const count = await countStarredMessages(userId);
    return {
      ok: true as const,
      starred: false,
      count,
      cap: STAR_SOFT_CAP,
      message: updated,
    };
  }

  if (existing.starredAt) {
    const count = await countStarredMessages(userId);
    return {
      ok: true as const,
      starred: true,
      count,
      cap: STAR_SOFT_CAP,
      message: existing,
    };
  }

  const count = await countStarredMessages(userId);
  if (count >= STAR_SOFT_CAP) {
    const oldest = await listStarredMessages(userId, STAR_SOFT_CAP);
    return {
      ok: false as const,
      error: `Star limit reached (${STAR_SOFT_CAP}). Unstar something before starring more.`,
      status: 409,
      count,
      cap: STAR_SOFT_CAP,
      starred: oldest,
    };
  }

  const updated = await prisma.message.update({
    where: { id },
    data: { starredAt: new Date() },
  });
  return {
    ok: true as const,
    starred: true,
    count: count + 1,
    cap: STAR_SOFT_CAP,
    message: updated,
  };
}
