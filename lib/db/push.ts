import { prisma } from "@/lib/db/client";

export async function upsertPushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  userId?: string | null;
}) {
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: input.endpoint },
    select: { userId: true },
  });
  if (existing?.userId && input.userId && existing.userId !== input.userId) {
    throw new Error("Push subscription belongs to another user.");
  }
  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      userId: input.userId ?? null,
    },
    update: {
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      ...(!existing?.userId && input.userId ? { userId: input.userId } : {}),
    },
  });
}

export async function deletePushSubscriptionByEndpoint(
  endpoint: string,
  options?: { userId?: string; includeLegacy?: boolean },
) {
  try {
    const result = await prisma.pushSubscription.deleteMany({
      where: {
        endpoint,
        ...(options?.userId
          ? options.includeLegacy
            ? { OR: [{ userId: options.userId }, { userId: null }] }
            : { userId: options.userId }
          : {}),
      },
    });
    return result.count > 0;
  } catch {
    return false;
  }
}

export async function listPushSubscriptions(options?: { userId?: string }) {
  return prisma.pushSubscription.findMany({
    where: options?.userId ? { userId: options.userId } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function listOwnerPushSubscriptions() {
  return prisma.pushSubscription.findMany({
    where: {
      OR: [{ user: { role: "owner" } }, { userId: null }],
    },
    orderBy: { createdAt: "desc" },
  });
}
