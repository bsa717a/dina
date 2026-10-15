/**
 * Per-user Grok Bots.
 *
 * Inbound texts and Slack handoff go to the sender's webhook when one is
 * stored, and otherwise to the env-var Dina bot. Task events go to every
 * project member's webhook (one POST per distinct URL). Members with no bot
 * share a single Dina fallback delivery.
 */

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/client";
import { toAuthUser, type AuthUser } from "@/lib/auth/types";
import { normalizeUsername } from "@/lib/auth/password";
import { decryptField, encryptField } from "@/lib/crypto/field-cipher";
import { logger } from "@/lib/logger";
import { getGrokBotConfig, type GrokBotConfig } from "@/lib/telnyx/config";

const USER_TOKEN_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  assistantName: true,
  assistantPersona: true,
  assistantKey: true,
  mustChangePassword: true,
  phoneNumber: true,
  sessionVersion: true,
} as const;

export function hashGrokApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateGrokApiToken(): string {
  return `grk_${randomBytes(32).toString("base64url")}`;
}

export function assertGrokWebhookUrl(raw: string): string {
  const webhookUrl = raw.trim();
  if (!webhookUrl || webhookUrl.length > 2000) {
    throw new Error("GROK_WEBHOOK_URL must be an http(s) URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("GROK_WEBHOOK_URL must be an http(s) URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("GROK_WEBHOOK_URL must be an http(s) URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("GROK_WEBHOOK_URL must not include credentials.");
  }
  return webhookUrl;
}

/**
 * null: no secret stored.
 * undefined: ciphertext present but it cannot be decrypted.
 */
export function revealWebhookSecret(
  stored: string | null | undefined,
): string | null | undefined {
  if (!stored?.trim()) return null;
  const plain = decryptField(stored);
  if (plain === null || plain.length === 0) return undefined;
  return plain;
}

export async function findUserByGrokApiToken(
  token: string,
): Promise<AuthUser | null> {
  const row = await prisma.user.findUnique({
    where: { grokApiTokenHash: hashGrokApiToken(token) },
    select: USER_TOKEN_SELECT,
  });
  return row ? toAuthUser(row) : null;
}

function botFromStored(input: {
  userId: string;
  grokWebhookUrl: string | null;
  grokWebhookSecret: string | null;
}): GrokBotConfig | null {
  const webhookUrl = input.grokWebhookUrl?.trim() || "";
  if (!webhookUrl) return null;
  const webhookSecret = revealWebhookSecret(input.grokWebhookSecret);
  if (input.grokWebhookSecret?.trim() && webhookSecret === undefined) {
    logger.error("grok_bot_secret_decrypt_failed", { userId: input.userId });
    return null;
  }
  return { webhookUrl, webhookSecret: webhookSecret ?? null };
}

export async function loadUserGrokBot(
  userId: string,
): Promise<GrokBotConfig | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      grokWebhookUrl: true,
      grokWebhookSecret: true,
    },
  });
  if (!row) return null;
  return botFromStored({
    userId: row.id,
    grokWebhookUrl: row.grokWebhookUrl,
    grokWebhookSecret: row.grokWebhookSecret,
  });
}

/** Sender's bot, or the env Dina bot when the sender has none. */
export async function resolveInboundGrokBot(
  userId: string | null | undefined,
): Promise<GrokBotConfig | null> {
  if (userId) {
    const own = await loadUserGrokBot(userId);
    if (own) return own;
  }
  return getGrokBotConfig();
}

/**
 * One target per webhook URL.
 * A project with no members still notifies Dina once (previous single-target behavior).
 * Members without a usable bot share one Dina delivery, not one per member.
 */
export async function resolveTaskGrokBots(
  projectKey: string,
): Promise<GrokBotConfig[]> {
  const members = await prisma.projectMember.findMany({
    where: { projectKey },
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      user: {
        select: {
          grokWebhookUrl: true,
          grokWebhookSecret: true,
        },
      },
    },
  });

  const targets: GrokBotConfig[] = [];
  const seen = new Set<string>();
  let fallback = members.length === 0;

  for (const member of members) {
    const bot = botFromStored({
      userId: member.userId,
      grokWebhookUrl: member.user.grokWebhookUrl,
      grokWebhookSecret: member.user.grokWebhookSecret,
    });
    if (!bot) {
      fallback = true;
      continue;
    }
    if (seen.has(bot.webhookUrl)) continue;
    seen.add(bot.webhookUrl);
    targets.push(bot);
  }

  if (fallback) {
    const env = getGrokBotConfig();
    const webhookUrl = env?.webhookUrl.trim() || "";
    if (env && webhookUrl && !seen.has(webhookUrl)) {
      targets.push({
        webhookUrl,
        webhookSecret: env.webhookSecret,
      });
    }
  }

  return targets;
}

export async function issueUserGrokBotCredentials(input: {
  username: string;
  webhookUrl: string;
  webhookSecret: string;
}): Promise<{ userId: string; username: string; webhookUrl: string; token: string }> {
  const username = normalizeUsername(input.username);
  if (!username) throw new Error("USERNAME is required.");
  const webhookUrl = assertGrokWebhookUrl(input.webhookUrl);
  const webhookSecret = input.webhookSecret.trim();
  if (!webhookSecret || webhookSecret.length > 2000) {
    throw new Error("GROK_WEBHOOK_SECRET is required.");
  }
  if (/[\u0000-\u001f\u007f]/.test(webhookSecret)) {
    throw new Error("GROK_WEBHOOK_SECRET contains invalid characters.");
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true },
  });
  if (!user) {
    throw new Error(`No Piper user found for username "${username}".`);
  }

  const token = generateGrokApiToken();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      grokWebhookUrl: webhookUrl,
      grokWebhookSecret: encryptField(webhookSecret),
      grokApiTokenHash: hashGrokApiToken(token),
    },
  });

  return {
    userId: user.id,
    username: user.username,
    webhookUrl,
    token,
  };
}
