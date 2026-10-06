import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH, normalizeUsername } from "@/lib/auth/password";
import {
  clearAuthFailures,
  getAuthLockoutStatus,
  recordFailedLogin,
} from "@/lib/auth/rate-limit";
import { getSession, requireReadySession } from "@/lib/auth/session";
import type { AuthUser } from "@/lib/auth/types";
import {
  authenticateUser,
  changePassword,
  needsOnboarding,
  PasswordChangeError,
} from "@/lib/auth/users";
import { checkDatabase } from "@/lib/db/client";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: z.string().min(1).max(64).optional(),
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(256),
  confirmPassword: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Enter your current password and a new password of at least 10 characters.");
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return jsonError("New passwords do not match.");
  }

  const ready = await requireReadySession();
  if (ready.ok) {
    if (
      parsed.data.username &&
      normalizeUsername(parsed.data.username) !== ready.user.username
    ) {
      return jsonError("That username does not match the signed-in account.");
    }
    return applyChange(request, ready.user, parsed.data.currentPassword, parsed.data.newPassword);
  }

  if (!parsed.data.username) return ready.response;

  const db = await checkDatabase();
  if (!db.ok) {
    return jsonError("Database is unavailable. Try again shortly.", 503);
  }

  const lockout = await getAuthLockoutStatus();
  if (lockout.locked) {
    return jsonError("Too many failed attempts. Try again later.", 429, {
      retryAfterMs: lockout.retryAfterMs,
    });
  }

  const user = await authenticateUser(parsed.data.username, parsed.data.currentPassword);
  if (!user) {
    const status = await recordFailedLogin();
    logger.warn("password_change_failed", { failCount: status.failCount });
    if (status.locked) {
      return jsonError("Too many failed attempts. Try again later.", 429, {
        retryAfterMs: status.retryAfterMs,
      });
    }
    return jsonError("Current password is incorrect.", 401);
  }

  await clearAuthFailures();
  return applyChange(
    request,
    user,
    parsed.data.currentPassword,
    parsed.data.newPassword,
    true,
  );
}

async function applyChange(
  request: NextRequest,
  user: AuthUser,
  currentPassword: string,
  newPassword: string,
  signIn = false,
) {
  try {
    const updated = await changePassword({
      userId: user.id,
      currentPassword,
      newPassword,
    });
    const session = await getSession(request);
    session.sessionVersion = updated.sessionVersion;
    if (signIn) {
      const onboarding = needsOnboarding({ ...user, mustChangePassword: false });
      session.authenticated = true;
      session.userId = user.id;
      session.role = user.role;
      session.needsOnboarding = onboarding;
      session.createdAt = Date.now();
      await session.save();
      logger.info("password_changed", { userId: user.id });
      return NextResponse.json({ ok: true, needsOnboarding: onboarding });
    }
    await session.save();
    logger.info("password_changed", { userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordChangeError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Could not change password.");
  }
}
