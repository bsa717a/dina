/**
 * Slack Events API request signature verification.
 *
 * Slack signs the raw body with HMAC-SHA256:
 *   v0=<hex(hmac_sha256(signing_secret, "v0:{timestamp}:{body}"))>
 *
 * Headers: X-Slack-Signature, X-Slack-Request-Timestamp
 * Reference: https://api.slack.com/authentication/verifying-requests-from-slack
 */

import { createHmac, timingSafeEqual } from "crypto";
import { getSlackConfig } from "./config";

const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface SlackVerificationResult {
  valid: boolean;
  reason?: string;
}

export function verifySlackSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  signingSecret?: string,
): SlackVerificationResult {
  const config = getSlackConfig();
  const secret = signingSecret ?? config?.signingSecret;

  if (!secret) {
    return { valid: false, reason: "no_signing_secret_configured" };
  }

  if (!signatureHeader || !timestampHeader) {
    return { valid: false, reason: "missing_signature_headers" };
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (Number.isNaN(timestamp)) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }

  const base = `v0:${timestampHeader}:${rawBody}`;
  const digest = createHmac("sha256", secret).update(base).digest("hex");
  const expected = `v0=${digest}`;

  try {
    const expectedBuf = Buffer.from(expected, "utf8");
    const providedBuf = Buffer.from(signatureHeader, "utf8");
    if (expectedBuf.length !== providedBuf.length) {
      return { valid: false, reason: "signature_mismatch" };
    }
    if (!timingSafeEqual(expectedBuf, providedBuf)) {
      return { valid: false, reason: "signature_mismatch" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "signature_verification_error" };
  }
}

export function extractSlackSignatureHeaders(headers: Headers): {
  signature: string | null;
  timestamp: string | null;
} {
  return {
    signature: headers.get("x-slack-signature"),
    timestamp: headers.get("x-slack-request-timestamp"),
  };
}
