/**
 * Field encryption for secrets that must be recovered later (webhook sender keys).
 *
 * Passwords and API tokens stay one-way hashes. A Grok webhook secret is sent
 * on each delivery, so it is stored as AES-256-GCM ciphertext keyed from
 * SESSION_SECRET. Format: aes-256-gcm:v1:<iv>:<tag>:<ciphertext> (base64url).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { getSessionSecret } from "@/lib/env";

const VERSION = "v1";

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(`dina-grok-webhook-secret:${getSessionSecret()}`)
    .digest();
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "aes-256-gcm",
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/** Returns null when the ciphertext is missing, corrupt, or the key does not match. */
export function decryptField(stored: string): string | null {
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== "aes-256-gcm" || parts[1] !== VERSION) {
    return null;
  }
  try {
    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const data = Buffer.from(parts[4], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || data.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
