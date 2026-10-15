/**
 * Regi-only scope guards for the Slack bot.
 *
 * v1 is hard-scoped to the Regi project. 4StudentLives and MetabolicOS
 * stay on the Telnyx RCS path and must never be written by this bot.
 */

import {
  resolveProjectKey,
  type ProjectKey,
} from "@/lib/projects/catalog";
import { getSlackConfig } from "./config";
import { SLACK_BLOCKED_PROJECT_KEYS } from "./types";

const IM_CHANNEL_TYPES = new Set(["im", "mpim"]);

export function resolveRegiProjectKey(): ProjectKey {
  const slug = getSlackConfig()?.projectSlug ?? "regi";
  const key = resolveProjectKey(slug);
  if (!key) {
    throw new Error(
      `SLACK_REGI_PROJECT_SLUG "${slug}" does not match a known project.`,
    );
  }
  if ((SLACK_BLOCKED_PROJECT_KEYS as readonly string[]).includes(key)) {
    throw new Error(
      `Slack bot cannot target "${key}". v1 is Regi-only; 4SL and Metabolic stay on Telnyx.`,
    );
  }
  return key;
}

export function isBlockedProjectKey(key: string): boolean {
  return (SLACK_BLOCKED_PROJECT_KEYS as readonly string[]).includes(key);
}

/**
 * Channels a per-user token may post into.
 * The env Dina token is not limited by this list.
 * An empty allowlist authorizes no channel, so a member token cannot
 * inherit the bot's ability to write everywhere it is installed.
 * DMs still require SLACK_REGI_ALLOW_IMS even when the id is listed.
 */
export function isProjectSlackChannel(channelId: string): boolean {
  const config = getSlackConfig();
  const id = channelId.trim();
  const allowlist = config?.channelIds ?? [];
  if (!id || !allowlist.includes(id)) return false;
  if (id.startsWith("D") && !config?.allowIms) return false;
  return true;
}

export function isChannelAllowed(
  channelId: string,
  channelType?: string,
): boolean {
  const config = getSlackConfig();
  const type = (channelType || "").toLowerCase();

  if (IM_CHANNEL_TYPES.has(type)) {
    return Boolean(config?.allowIms);
  }

  const allowlist = config?.channelIds ?? [];
  if (allowlist.length === 0) return true;
  return allowlist.includes(channelId);
}

export function isOwnBotMessage(event: {
  botId?: string;
  slackUserId?: string;
}): boolean {
  if (event.botId) return true;
  const botUserId = getSlackConfig()?.botUserId;
  if (botUserId && event.slackUserId && event.slackUserId === botUserId) {
    return true;
  }
  return false;
}

export function shouldIgnoreMessageSubtype(subtype?: string): boolean {
  if (!subtype) return false;
  return subtype !== "file_share";
}
