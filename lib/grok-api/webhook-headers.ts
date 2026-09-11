/**
 * Outbound auth headers for Grok Bot routine webhooks.
 *
 * Grok Bot Routines authenticate the sender with:
 *   Authorization: Bearer <sender key>   (primary)
 *   X-Automation-Key: <same key>
 *
 * GROK_BOT_DINA_WEBHOOK_SECRET must be the Routines panel sender key
 * (typically crsr_…). HMAC headers are kept as a short compatibility
 * window for any consumer that still verified X-Grok-Bot-Signature.
 */

import { createHmac } from "crypto";

export function buildGrokBotWebhookHeaders(
  body: string,
  webhookSecret: string | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!webhookSecret) {
    return headers;
  }

  headers.Authorization = `Bearer ${webhookSecret}`;
  headers["X-Automation-Key"] = webhookSecret;
  headers["X-Grok-Bot-Signature"] = createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");
  headers["X-Grok-Bot-Timestamp"] = String(Math.floor(Date.now() / 1000));

  return headers;
}
