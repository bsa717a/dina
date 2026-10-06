import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { requireReadySession } from "@/lib/auth/session";
import { PasswordChangeError, setPasswordForUser } from "@/lib/auth/users";
import { forbidden, jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: z.string().trim().min(1).max(64),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(256),
  confirmPassword: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  const ready = await requireReadySession();
  if (!ready.ok) return ready.response;
  if (ready.user.role !== "owner") {
    return forbidden("Only the owner can set another user's password.");
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Enter a username and a new password of at least 10 characters.");
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return jsonError("New passwords do not match.");
  }

  try {
    const updated = await setPasswordForUser({
      actorId: ready.user.id,
      username: parsed.data.username,
      newPassword: parsed.data.newPassword,
    });
    logger.info("user_password_set", {
      actorId: ready.user.id,
      username: updated.username,
    });
    return NextResponse.json({ ok: true, username: updated.username });
  } catch (error) {
    if (error instanceof PasswordChangeError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Could not set that password.");
  }
}
