function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getAppUrl(): string {
  return (process.env.APP_URL || "http://localhost:8080").replace(/\/$/, "");
}

export function isHttpsApp(): boolean {
  const appUrl = getAppUrl();
  return appUrl.startsWith("https://") || process.env.NODE_ENV === "production";
}

export function getAccessCode(): string {
  return required("ACCESS_CODE");
}

export function getSessionSecret(): string {
  return required("SESSION_SECRET");
}

export function getOpenAIApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

/**
 * Legacy single-model env. Prefer getOpenAIChatModel / getOpenAIResearchModel.
 * Kept so older OPENAI_MODEL=… still works as the chat default.
 */
export function getOpenAIModel(): string {
  return getOpenAIChatModel();
}

/** Routine chat: mail, calendar, CoS Q&A, light tool use. Default: gpt-4.1-nano */
export function getOpenAIChatModel(): string {
  return (
    process.env.OPENAI_MODEL_CHAT?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4.1-nano"
  );
}

/**
 * Heavier synthesis: morning ritual, markets, church verification search.
 * Default: gpt-4.1
 */
export function getOpenAIResearchModel(): string {
  return process.env.OPENAI_MODEL_RESEARCH?.trim() || "gpt-4.1";
}

export function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@localhost";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export { getMicrosoftConfig, isMicrosoftConfigured } from "@/lib/microsoft/config";
export { getGoogleConfig, isGoogleConfigured } from "@/lib/google/config";

export function getAttentionScanSecret(): string | undefined {
  return process.env.ATTENTION_SCAN_SECRET?.trim() || undefined;
}

/** Default calendar/mail wall-clock timezone for Graph Prefer header. */
export function getDefaultTimeZone(): string {
  return process.env.DEFAULT_TIMEZONE?.trim() || "America/Denver";
}

// --- Telnyx RCS/SMS Configuration ---

export function getTelnyxApiKey(): string | undefined {
  return process.env.TELNYX_API_KEY?.trim() || undefined;
}

export function getTelnyxRcsAgentId(): string | undefined {
  return process.env.TELNYX_RCS_AGENT_ID?.trim() || undefined;
}

export function getTelnyxSmsFrom(): string | undefined {
  return process.env.TELNYX_SMS_FROM?.trim() || undefined;
}

export function getTelnyxMessagingProfileId(): string | undefined {
  return process.env.TELNYX_MESSAGING_PROFILE_ID?.trim() || undefined;
}

export function getTelnyxWebhookSigningSecret(): string | undefined {
  return process.env.TELNYX_WEBHOOK_SIGNING_SECRET?.trim() || undefined;
}

export function getGrokBotDinaWebhookUrl(): string | undefined {
  return process.env.GROK_BOT_DINA_WEBHOOK_URL?.trim() || undefined;
}

export function getGrokBotDinaWebhookSecret(): string | undefined {
  return process.env.GROK_BOT_DINA_WEBHOOK_SECRET?.trim() || undefined;
}

export function getGrokBotDinaApiToken(): string | undefined {
  return process.env.GROK_BOT_DINA_API_TOKEN?.trim() || undefined;
}

export function isTelnyxConfigured(): boolean {
  return Boolean(getTelnyxApiKey() && getTelnyxSmsFrom());
}
