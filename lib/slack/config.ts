/**
 * Slack configuration for the Regi-only Piper bot.
 */

import {
  getSlackAppToken,
  getSlackBotToken,
  getSlackBotUserId,
  getSlackRegiAllowIms,
  getSlackRegiChannelIds,
  getSlackRegiProjectSlug,
  getSlackSigningSecret,
  getSlackSocketModeProcess,
  getSlackUserMap,
  isSlackConfigured,
  isSlackSocketModeConfigured,
} from "@/lib/env";

export interface SlackConfig {
  botToken: string;
  signingSecret: string;
  appToken: string | null;
  projectSlug: string;
  channelIds: string[];
  allowIms: boolean;
  botUserId: string | null;
  userMap: Record<string, string>;
  socketMode: boolean;
}

export function getSlackConfig(): SlackConfig | null {
  if (!isSlackConfigured()) return null;
  const botToken = getSlackBotToken();
  const signingSecret = getSlackSigningSecret();
  if (!botToken || !signingSecret) return null;

  return {
    botToken,
    signingSecret,
    appToken: getSlackAppToken() ?? null,
    projectSlug: getSlackRegiProjectSlug(),
    channelIds: getSlackRegiChannelIds(),
    allowIms: getSlackRegiAllowIms(),
    botUserId: getSlackBotUserId() ?? null,
    userMap: getSlackUserMap(),
    socketMode: isSlackSocketModeConfigured(),
  };
}

export { isSlackConfigured, isSlackSocketModeConfigured, getSlackSocketModeProcess };
