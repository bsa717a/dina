import { generateKeyPairSync, sign } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTelnyxSignature, extractSignatureHeaders } from "@/lib/telnyx/verify";

const TEST_BODY = '{"data":{"event_type":"message.received"}}';

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
const PUBLIC_KEY_B64 = spki.subarray(spki.length - 32).toString("base64");

function signBody(body: string, timestamp: string): string {
  const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey);
  return signature.toString("base64");
}

describe("verifyTelnyxSignature", () => {
  beforeEach(() => {
    delete process.env.TELNYX_PUBLIC_KEY;
  });

  it("accepts a valid Ed25519 signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifyTelnyxSignature(TEST_BODY, signBody(TEST_BODY, timestamp), timestamp, {
      publicKey: PUBLIC_KEY_B64,
    });
    expect(result.valid).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects a signature for a different body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifyTelnyxSignature(
      TEST_BODY,
      signBody('{"other":true}', timestamp),
      timestamp,
      { publicKey: PUBLIC_KEY_B64 },
    );
    expect(result.valid).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects missing signature headers when the public key is set", () => {
    const result = verifyTelnyxSignature(TEST_BODY, null, null, {
      publicKey: PUBLIC_KEY_B64,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_signature_headers");
  });

  it("rejects stale timestamps", () => {
    const timestamp = String(Math.floor(Date.now() / 1000) - 600);
    const result = verifyTelnyxSignature(TEST_BODY, signBody(TEST_BODY, timestamp), timestamp, {
      publicKey: PUBLIC_KEY_B64,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("timestamp_out_of_tolerance");
  });

  it("rejects a non-numeric timestamp", () => {
    const result = verifyTelnyxSignature(TEST_BODY, signBody(TEST_BODY, "123"), "not-a-number", {
      publicKey: PUBLIC_KEY_B64,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_timestamp");
  });

  it("fails closed when the configured public key cannot verify", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifyTelnyxSignature(TEST_BODY, signBody(TEST_BODY, timestamp), timestamp, {
      publicKey: "not-a-valid-key",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_verification_error");
  });

  it("does not treat a missing key as a verified signature outside production", () => {
    const result = verifyTelnyxSignature(TEST_BODY, null, null);
    expect(result.valid).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("no_public_key_configured");
  });

  it("fails closed in production when TELNYX_PUBLIC_KEY is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.TELNYX_PUBLIC_KEY;
    try {
      const result = verifyTelnyxSignature(TEST_BODY, null, null);
      expect(result.valid).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.reason).toBe("public_key_required");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed in production once TELNYX_PUBLIC_KEY is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_B64);
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const missing = verifyTelnyxSignature(TEST_BODY, null, null);
      expect(missing.valid).toBe(false);
      expect(missing.reason).toBe("missing_signature_headers");

      const bad = verifyTelnyxSignature(
        TEST_BODY,
        signBody('{"tampered":true}', timestamp),
        timestamp,
      );
      expect(bad.valid).toBe(false);
      expect(bad.reason).toBe("signature_mismatch");

      const good = verifyTelnyxSignature(
        TEST_BODY,
        signBody(TEST_BODY, timestamp),
        timestamp,
      );
      expect(good.valid).toBe(true);
      expect(good.verified).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("extractSignatureHeaders", () => {
  it("extracts telnyx-signature-ed25519 header", () => {
    const headers = new Headers();
    headers.set("telnyx-signature-ed25519", "sig123");
    headers.set("telnyx-timestamp", "1234567890");

    const result = extractSignatureHeaders(headers);

    expect(result.signature).toBe("sig123");
    expect(result.timestamp).toBe("1234567890");
  });

  it("falls back to telnyx-signature header", () => {
    const headers = new Headers();
    headers.set("telnyx-signature", "sig456");
    headers.set("telnyx-timestamp", "1234567890");

    const result = extractSignatureHeaders(headers);

    expect(result.signature).toBe("sig456");
    expect(result.timestamp).toBe("1234567890");
  });

  it("returns null for missing headers", () => {
    const headers = new Headers();
    const result = extractSignatureHeaders(headers);

    expect(result.signature).toBeNull();
    expect(result.timestamp).toBeNull();
  });
});
