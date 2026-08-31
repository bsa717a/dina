import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const TEST_SECRET = "test-webhook-secret-12345";
const TEST_BODY = '{"data":{"event_type":"message.received"}}';

function generateValidSignature(
  body: string,
  timestamp: number,
  secret: string,
): string {
  const signedPayload = `${timestamp}.${body}`;
  return createHmac("sha256", secret).update(signedPayload).digest("hex");
}

const mockGetTelnyxConfig = vi.fn();

vi.mock("@/lib/telnyx/config", () => ({
  getTelnyxConfig: () => mockGetTelnyxConfig(),
}));

describe("verifyTelnyxSignature", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetTelnyxConfig.mockReset();
  });

  it("accepts valid signatures", async () => {
    mockGetTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "test-agent",
      smsFrom: "+14352382071",
      messagingProfileId: "test-profile",
      webhookSigningSecret: TEST_SECRET,
    });

    const { verifyTelnyxSignature } = await import("@/lib/telnyx/verify");
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateValidSignature(TEST_BODY, timestamp, TEST_SECRET);

    const result = verifyTelnyxSignature(
      TEST_BODY,
      `v1=${signature}`,
      String(timestamp),
    );

    expect(result.valid).toBe(true);
  });

  it("rejects invalid signatures", async () => {
    mockGetTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "test-agent",
      smsFrom: "+14352382071",
      messagingProfileId: "test-profile",
      webhookSigningSecret: TEST_SECRET,
    });

    const { verifyTelnyxSignature } = await import("@/lib/telnyx/verify");
    const timestamp = Math.floor(Date.now() / 1000);

    const result = verifyTelnyxSignature(
      TEST_BODY,
      "v1=0000000000000000000000000000000000000000000000000000000000000000",
      String(timestamp),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects missing signature headers", async () => {
    mockGetTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "test-agent",
      smsFrom: "+14352382071",
      messagingProfileId: "test-profile",
      webhookSigningSecret: TEST_SECRET,
    });

    const { verifyTelnyxSignature } = await import("@/lib/telnyx/verify");
    const result = verifyTelnyxSignature(TEST_BODY, null, null);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_signature_headers");
  });

  it("rejects old timestamps", async () => {
    mockGetTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "test-agent",
      smsFrom: "+14352382071",
      messagingProfileId: "test-profile",
      webhookSigningSecret: TEST_SECRET,
    });

    const { verifyTelnyxSignature } = await import("@/lib/telnyx/verify");
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const signature = generateValidSignature(
      TEST_BODY,
      oldTimestamp,
      TEST_SECRET,
    );

    const result = verifyTelnyxSignature(
      TEST_BODY,
      `v1=${signature}`,
      String(oldTimestamp),
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("timestamp_out_of_tolerance");
  });

  it("rejects invalid timestamp format", async () => {
    mockGetTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "test-agent",
      smsFrom: "+14352382071",
      messagingProfileId: "test-profile",
      webhookSigningSecret: TEST_SECRET,
    });

    const { verifyTelnyxSignature } = await import("@/lib/telnyx/verify");
    const signature = generateValidSignature(TEST_BODY, 12345, TEST_SECRET);

    const result = verifyTelnyxSignature(
      TEST_BODY,
      `v1=${signature}`,
      "not-a-number",
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_timestamp");
  });

  it("accepts requests when no signing secret is configured", async () => {
    mockGetTelnyxConfig.mockReturnValue({
      apiKey: "test-key",
      rcsAgentId: "test-agent",
      smsFrom: "+14352382071",
      messagingProfileId: "test-profile",
      webhookSigningSecret: null,
    });

    const { verifyTelnyxSignature } = await import("@/lib/telnyx/verify");
    const result = verifyTelnyxSignature(TEST_BODY, null, null, undefined);

    expect(result.valid).toBe(true);
    expect(result.reason).toBe("no_signing_secret_configured");
  });
});

describe("extractSignatureHeaders", () => {
  it("extracts telnyx-signature-ed25519 header", async () => {
    const { extractSignatureHeaders } = await import("@/lib/telnyx/verify");
    const headers = new Headers();
    headers.set("telnyx-signature-ed25519", "sig123");
    headers.set("telnyx-timestamp", "1234567890");

    const result = extractSignatureHeaders(headers);

    expect(result.signature).toBe("sig123");
    expect(result.timestamp).toBe("1234567890");
  });

  it("falls back to telnyx-signature header", async () => {
    const { extractSignatureHeaders } = await import("@/lib/telnyx/verify");
    const headers = new Headers();
    headers.set("telnyx-signature", "sig456");
    headers.set("telnyx-timestamp", "1234567890");

    const result = extractSignatureHeaders(headers);

    expect(result.signature).toBe("sig456");
    expect(result.timestamp).toBe("1234567890");
  });

  it("returns null for missing headers", async () => {
    const { extractSignatureHeaders } = await import("@/lib/telnyx/verify");
    const headers = new Headers();

    const result = extractSignatureHeaders(headers);

    expect(result.signature).toBeNull();
    expect(result.timestamp).toBeNull();
  });
});
