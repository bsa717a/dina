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

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

export function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@localhost";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

export { getMicrosoftConfig, isMicrosoftConfigured } from "@/lib/microsoft/config";

export function getAttentionScanSecret(): string | undefined {
  return process.env.ATTENTION_SCAN_SECRET?.trim() || undefined;
}

/** Default calendar/mail wall-clock timezone for Graph Prefer header. */
export function getDefaultTimeZone(): string {
  return process.env.DEFAULT_TIMEZONE?.trim() || "America/Denver";
}
