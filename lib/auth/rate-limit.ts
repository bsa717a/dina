import { prisma } from "@/lib/db/client";

const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export async function getAuthLockoutStatus() {
  const record = await prisma.authAttempt.findUnique({ where: { id: "singleton" } });
  if (!record?.lockedUntil) {
    return { locked: false, failCount: record?.failCount ?? 0, retryAfterMs: 0 };
  }
  const remaining = record.lockedUntil.getTime() - Date.now();
  if (remaining <= 0) {
    await prisma.authAttempt.update({
      where: { id: "singleton" },
      data: { failCount: 0, lockedUntil: null },
    });
    return { locked: false, failCount: 0, retryAfterMs: 0 };
  }
  return { locked: true, failCount: record.failCount, retryAfterMs: remaining };
}

export async function recordFailedLogin() {
  const current = await prisma.authAttempt.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", failCount: 1 },
    update: { failCount: { increment: 1 } },
  });

  if (current.failCount >= MAX_FAILURES) {
    const locked = await prisma.authAttempt.update({
      where: { id: "singleton" },
      data: { lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
    });
    return {
      locked: true,
      failCount: locked.failCount,
      retryAfterMs: LOCKOUT_MS,
    };
  }

  return { locked: false, failCount: current.failCount, retryAfterMs: 0 };
}

export async function clearAuthFailures() {
  await prisma.authAttempt.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", failCount: 0, lockedUntil: null },
    update: { failCount: 0, lockedUntil: null },
  });
}

export const AUTH_RATE_LIMIT = { MAX_FAILURES, LOCKOUT_MS };
