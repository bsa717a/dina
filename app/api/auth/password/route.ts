import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { requireReadySession } from "@/lib/auth/session";
import { changePassword, PasswordChangeError } from "@/lib/auth/users";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(256),
  confirmPassword: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  const ready = await requireReadySession();
  if (!ready.ok) return ready.response;

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

  try {
    await changePassword({
      userId: ready.user.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    });
    logger.info("password_changed", { userId: ready.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordChangeError) {
      return jsonError(error.message, error.status);
    }
    return jsonError("Could not change password.");
  }
}
