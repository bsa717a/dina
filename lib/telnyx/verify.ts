/**
 * Telnyx v2 webhook signature verification.
 *
 * Telnyx signs the raw body with Ed25519. The signature is the base64
 * `telnyx-signature-ed25519` header. The unix timestamp (seconds) is
 * `telnyx-timestamp`. The signed payload is `${timestamp}|${rawBody}`.
 * The account public key is TELNYX_PUBLIC_KEY (base64 raw 32-byte key,
 * or a PEM / SPKI public key).
 *
 * `verified` is true only after Ed25519 verification succeeds. Callers
 * must not persist STOP/START or send replies unless that is true.
 *
 * In production, a missing TELNYX_PUBLIC_KEY fails closed (`valid: false`).
 * Outside production, a missing key can accept the POST for local pipe
 * tests, but `verified` stays false so SMS state and replies stay blocked.
 * Once the key is set, missing, stale, or invalid signatures are rejected.
 *
 * Reference: https://developers.telnyx.com/development/api-fundamentals/webhooks/receiving-webhooks
 */

import { createPublicKey, verify, type KeyObject } from "crypto";
import { getTelnyxPublicKey } from "@/lib/env";

const SIGNATURE_TOLERANCE_SECONDS = 300;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface WebhookVerificationResult {
  /** Whether the HTTP request may be processed at all. */
  valid: boolean;
  /**
   * True only when the Ed25519 signature checked out.
   * Never persist opt-out or send a reply unless this is true.
   */
  verified: boolean;
  reason?: string;
}

export interface VerifyTelnyxOptions {
  /** Pass null to force "no key" even if TELNYX_PUBLIC_KEY is set. */
  publicKey?: string | null;
}

function publicKeyObject(rawKey: string): KeyObject {
  const trimmed = rawKey.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(trimmed);
  }

  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, decoded]),
      format: "der",
      type: "spki",
    });
  }

  return createPublicKey({
    key: decoded,
    format: "der",
    type: "spki",
  });
}

export function verifyTelnyxSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  options?: VerifyTelnyxOptions,
): WebhookVerificationResult {
  const publicKey =
    options && "publicKey" in options
      ? options.publicKey?.trim() || undefined
      : getTelnyxPublicKey();

  if (!publicKey) {
    if (process.env.NODE_ENV === "production") {
      return {
        valid: false,
        verified: false,
        reason: "public_key_required",
      };
    }
    return {
      valid: true,
      verified: false,
      reason: "no_public_key_configured",
    };
  }

  if (!signatureHeader || !timestampHeader) {
    return { valid: false, verified: false, reason: "missing_signature_headers" };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, verified: false, reason: "invalid_timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, verified: false, reason: "timestamp_out_of_tolerance" };
  }

  try {
    const key = publicKeyObject(publicKey);
    const signature = Buffer.from(signatureHeader, "base64");
    const ok = verify(
      null,
      Buffer.from(`${timestampHeader}|${rawBody}`),
      key,
      signature,
    );
    if (!ok) return { valid: false, verified: false, reason: "signature_mismatch" };
    return { valid: true, verified: true };
  } catch {
    return { valid: false, verified: false, reason: "signature_verification_error" };
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
