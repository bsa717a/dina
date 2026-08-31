/**
 * Telnyx configuration helpers.
 */

import {
  getTelnyxApiKey,
  getTelnyxRcsAgentId,
  getTelnyxSmsFrom,
  getTelnyxMessagingProfileId,
  getTelnyxWebhookSigningSecret,
  getGrokBotDinaWebhookUrl,
  getGrokBotDinaWebhookSecret,
  isTelnyxConfigured,
} from "@/lib/env";

export interface TelnyxConfig {
  apiKey: string;
  rcsAgentId: string | null;
  smsFrom: string;
  messagingProfileId: string | null;
  webhookSigningSecret: string | null;
}

export interface GrokBotConfig {
  webhookUrl: string;
  webhookSecret: string | null;
}

export function getTelnyxConfig(): TelnyxConfig | null {
  if (!isTelnyxConfigured()) return null;
  const apiKey = getTelnyxApiKey();
  const smsFrom = getTelnyxSmsFrom();
  if (!apiKey || !smsFrom) return null;

  return {
    apiKey,
    rcsAgentId: getTelnyxRcsAgentId() ?? null,
    smsFrom,
    messagingProfileId: getTelnyxMessagingProfileId() ?? null,
    webhookSigningSecret: getTelnyxWebhookSigningSecret() ?? null,
  };
}

export function getGrokBotConfig(): GrokBotConfig | null {
  const webhookUrl = getGrokBotDinaWebhookUrl();
  if (!webhookUrl) return null;

  return {
    webhookUrl,
    webhookSecret: getGrokBotDinaWebhookSecret() ?? null,
  };
}

export function isGrokBotConfigured(): boolean {
  return Boolean(getGrokBotDinaWebhookUrl());
}

export { isTelnyxConfigured };
