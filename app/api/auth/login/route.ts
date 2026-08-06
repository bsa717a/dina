import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAccessCode } from "@/lib/auth/access-code";
import {
  clearAuthFailures,
  getAuthLockoutStatus,
  recordFailedLogin,
} from "@/lib/auth/rate-limit";
import { getSession } from "@/lib/auth/session";
import { getAccessCode } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkDatabase } from "@/lib/db/client";

export const runtime = "nodejs";

const bodySchema = z.object({
  code: z.string().min(1).max(256),
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
    return jsonError("Access code is required.");
  }

  const lockout = await getAuthLockoutStatus();
  if (lockout.locked) {
    return jsonError("Too many failed attempts. Try again later.", 429, {
      retryAfterMs: lockout.retryAfterMs,
    });
  }

  let expected: string;
  try {
    expected = getAccessCode();
  } catch {
    logger.error("access_code_missing");
    return jsonError("Server is misconfigured.", 500);
  }

  const ok = verifyAccessCode(parsed.data.code, expected);
  if (!ok) {
    const status = await recordFailedLogin();
    logger.warn("login_failed", { failCount: status.failCount });
    if (status.locked) {
      return jsonError("Too many failed attempts. Try again later.", 429, {
        retryAfterMs: status.retryAfterMs,
      });
    }
    return jsonError("Invalid access code.", 401);
  }

  await clearAuthFailures();
  const session = await getSession();
  session.authenticated = true;
  session.createdAt = Date.now();
  await session.save();

  logger.info("login_success");
  return NextResponse.json({ ok: true });
}
