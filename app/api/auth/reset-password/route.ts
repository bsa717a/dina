import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { resetPassword, ResetPasswordError } from "@/lib/auth/password-reset";
import { jsonError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().trim().min(1).max(512),
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
    return jsonError("Choose a password of at least 10 characters.");
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return jsonError("Passwords do not match.");
  }

  try {
    await resetPassword({
      token: parsed.data.token,
      newPassword: parsed.data.newPassword,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ResetPasswordError) {
      return jsonError(error.message, error.status);
    }
    logger.error("password_reset_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return jsonError("Could not reset password.");
  }
}
