import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/client";
import { getAppUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getMicrosoftConfig, isMicrosoftConfigured } from "@/lib/microsoft/config";
import {
  hashPassword,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  normalizeUsername,
} from "@/lib/auth/password";
import { sendInviteEmail } from "@/lib/team/invite";

export const RESET_TTL_MS = 60 * 60 * 1000;
export const MAX_RESETS_PER_HOUR = 3;

const GENERIC_MESSAGE =
  "If that account has an email on file, we sent a reset link. It expires in one hour.";

export function forgotPasswordMessage(): string {
  return GENERIC_MESSAGE;
}

export class ResetPasswordError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ResetPasswordError";
    this.status = status;
  }
}

type SendMail = (input: { to: string; subject: string; body: string }) => Promise<void>;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ownerFallbackEmail(): string | null {
  const fromEnv = process.env.OWNER_EMAIL?.trim();
  if (fromEnv && isValidEmail(fromEnv)) return normalizeEmail(fromEnv);
  const microsoft = getMicrosoftConfig()?.userEmail?.trim();
  if (microsoft && isValidEmail(microsoft)) return normalizeEmail(microsoft);
  return null;
}

export function buildResetEmail(input: { username: string; resetUrl: string }): {
  subject: string;
  body: string;
} {
  return {
    subject: "Reset your Dina password",
    body: [
      "I'm Dina.",
      "",
      `Someone asked to reset the password for ${input.username}. If that was you, open this link within an hour:`,
      "",
      input.resetUrl,
      "",
      "If it wasn't you, ignore this note. The current password keeps working.",
      "",
      "— Dina",
    ].join("\n"),
  };
}

export async function requestPasswordReset(
  identifier: string,
  options?: { sendMail?: SendMail; mailConfigured?: boolean },
): Promise<{ delivered: boolean }> {
  const sendMail = options?.sendMail ?? sendInviteEmail;
  const mailConfigured = options?.mailConfigured ?? isMicrosoftConfigured();
  const raw = identifier.trim();
  if (!raw) return { delivered: false };

  const user = raw.includes("@")
    ? await prisma.user.findUnique({ where: { email: normalizeEmail(raw) } })
    : await prisma.user.findUnique({ where: { username: normalizeUsername(raw) } });
  if (!user) return { delivered: false };

  let email = user.email ? normalizeEmail(user.email) : null;
  if (!email && user.role === "owner") {
    const fallback = ownerFallbackEmail();
    if (fallback) {
      const taken = await prisma.user.findUnique({ where: { email: fallback } });
      if (!taken || taken.id === user.id) {
        email = fallback;
        if (user.email !== fallback) {
          await prisma.user.update({
            where: { id: user.id },
            data: { email: fallback },
          });
        }
      }
    }
  }
  if (!email || !mailConfigured) return { delivered: false };

  const since = new Date(Date.now() - RESET_TTL_MS);
  const recent = await prisma.passwordReset.count({
    where: { userId: user.id, createdAt: { gte: since } },
  });
  if (recent >= MAX_RESETS_PER_HOUR) return { delivered: false };

  const token = randomBytes(32).toString("base64url");
  const created = await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  const message = buildResetEmail({
    username: user.username,
    resetUrl: `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`,
  });

  try {
    await sendMail({ to: email, subject: message.subject, body: message.body });
  } catch (error) {
    await prisma.passwordReset.delete({ where: { id: created.id } }).catch(() => undefined);
    logger.error("password_reset_send_failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { delivered: false };
  }

  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null, id: { not: created.id } },
    data: { usedAt: new Date() },
  });
  logger.info("password_reset_sent", { userId: user.id });
  return { delivered: true };
}

export async function resetPassword(input: {
  token: string;
  newPassword: string;
}): Promise<void> {
  const token = input.token.trim();
  if (!token) {
    throw new ResetPasswordError("This reset link is invalid or has expired.");
  }
  if (!isValidPassword(input.newPassword)) {
    throw new ResetPasswordError("Password must be at least 10 characters.");
  }

  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    throw new ResetPasswordError("This reset link is invalid or has expired.");
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: {
        passwordHash: hashPassword(input.newPassword),
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
      },
    }),
    prisma.passwordReset.update({
      where: { id: row.id },
      data: { usedAt: now },
    }),
    prisma.passwordReset.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: now },
    }),
  ]);
  logger.info("password_reset_complete", { userId: row.userId });
}
