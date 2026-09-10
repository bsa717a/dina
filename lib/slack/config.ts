/**
 * Slack configuration for the Regi-only Piper bot.
 */

import {
  getSlackBotToken,
  getSlackBotUserId,
  getSlackRegiAllowIms,
  getSlackRegiChannelIds,
  getSlackRegiProjectSlug,
  getSlackSigningSecret,
  getSlackUserMap,
  isSlackConfigured,
} from "@/lib/env";

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  projectSlug: string;
  channelIds: string[];
  allowIms: boolean;
  botUserId: string | null;
  userMap: Record<string, string>;
}

export function getSlackConfig(): SlackConfig | null {
  if (!isSlackConfigured()) return null;
  const botToken = getSlackBotToken();
  const signingSecret = getSlackSigningSecret();
  if (!botToken || !signingSecret) return null;

  return {
    botToken,
    signingSecret,
    projectSlug: getSlackRegiProjectSlug(),
    channelIds: getSlackRegiChannelIds(),
    allowIms: getSlackRegiAllowIms(),
    botUserId: getSlackBotUserId() ?? null,
    userMap: getSlackUserMap(),
  };
}

export { isSlackConfigured };
