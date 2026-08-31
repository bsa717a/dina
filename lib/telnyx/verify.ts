/**
 * Telnyx webhook signature verification.
 *
 * Telnyx signs webhooks using a timestamp + HMAC-SHA256 signature.
 * The signature is in the `telnyx-signature-ed25519` header (or `telnyx-signature`).
 * The timestamp is in the `telnyx-timestamp` header.
 *
 * Reference: https://developers.telnyx.com/docs/v2/development/webhooks
 */

import { createHmac, timingSafeEqual } from "crypto";
import { getTelnyxConfig } from "./config";

const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

export function verifyTelnyxSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  signingSecret?: string,
): WebhookVerificationResult {
  const config = getTelnyxConfig();
  const secret = signingSecret ?? config?.webhookSigningSecret;

  if (!secret) {
    return { valid: true, reason: "no_signing_secret_configured" };
  }

  if (!signatureHeader || !timestampHeader) {
    return { valid: false, reason: "missing_signature_headers" };
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: "timestamp_out_of_tolerance" };
  }

  const signedPayload = `${timestampHeader}.${rawBody}`;

  const expectedSignature = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  const providedSignature = signatureHeader.replace(/^v1=/, "").toLowerCase();

  try {
    const expected = Buffer.from(expectedSignature, "hex");
    const provided = Buffer.from(providedSignature, "hex");

    if (expected.length !== provided.length) {
      return { valid: false, reason: "signature_length_mismatch" };
    }

    if (!timingSafeEqual(expected, provided)) {
      return { valid: false, reason: "signature_mismatch" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "signature_verification_error" };
  }
}

export function extractSignatureHeaders(headers: Headers): {
  signature: string | null;
  timestamp: string | null;
} {
  return {
    signature:
      headers.get("telnyx-signature-ed25519") ??
      headers.get("telnyx-signature") ??
      null,
    timestamp: headers.get("telnyx-timestamp") ?? null,
  };
}
