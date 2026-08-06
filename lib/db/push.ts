import { prisma } from "@/lib/db/client";

export async function upsertPushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
    update: {
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function deletePushSubscriptionByEndpoint(endpoint: string) {
  try {
    await prisma.pushSubscription.delete({ where: { endpoint } });
    return true;
  } catch {
    return false;
  }
}

export async function listPushSubscriptions() {
  return prisma.pushSubscription.findMany({ orderBy: { createdAt: "desc" } });
}
