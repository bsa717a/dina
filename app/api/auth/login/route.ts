import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateUser, needsOnboarding } from "@/lib/auth/users";
import {
  clearAuthFailures,
  getAuthLockoutStatus,
  recordFailedLogin,
} from "@/lib/auth/rate-limit";
import { getSession } from "@/lib/auth/session";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkDatabase } from "@/lib/db/client";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  const db = await checkDatabase();
  if (!db.ok) {
    return jsonError("Database is unavailable. Try again shortly.", 503);
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Username and password are required.");
  }

  const lockout = await getAuthLockoutStatus();
  if (lockout.locked) {
    return jsonError("Too many failed attempts. Try again later.", 429, {
      retryAfterMs: lockout.retryAfterMs,
    });
  }

  const user = await authenticateUser(parsed.data.username, parsed.data.password);
  if (!user) {
    const status = await recordFailedLogin();
    logger.warn("login_failed", { failCount: status.failCount });
    if (status.locked) {
      return jsonError("Too many failed attempts. Try again later.", 429, {
        retryAfterMs: status.retryAfterMs,
      });
    }
    return jsonError("Invalid username or password.", 401);
  }

  await clearAuthFailures();
  const onboarding = needsOnboarding(user);
  const session = await getSession(request);
  session.authenticated = true;
  session.userId = user.id;
  session.role = user.role;
  session.needsOnboarding = onboarding;
  session.createdAt = Date.now();
  await session.save();

  logger.info("login_success", { userId: user.id, role: user.role });
  return NextResponse.json({
    ok: true,
    needsOnboarding: onboarding,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      assistantName: user.assistantName,
      assistantKey: user.assistantKey,
    },
  });
}
