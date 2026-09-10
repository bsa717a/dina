import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";

const TEST_SECRET = "slack-signing-secret-test";
const TEST_BODY = '{"type":"event_callback"}';

function sign(body: string, timestamp: number, secret: string): string {
  const digest = createHmac("sha256", secret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex");
  return `v0=${digest}`;
}

const mockGetSlackConfig = vi.fn();

vi.mock("@/lib/slack/config", () => ({
  getSlackConfig: () => mockGetSlackConfig(),
}));

describe("verifySlackSignature", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetSlackConfig.mockReset();
  });

  it("accepts a valid Slack signature", async () => {
    mockGetSlackConfig.mockReturnValue({ signingSecret: TEST_SECRET });
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const timestamp = Math.floor(Date.now() / 1000);
    const result = verifySlackSignature(
      TEST_BODY,
      sign(TEST_BODY, timestamp, TEST_SECRET),
      String(timestamp),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid signature", async () => {
    mockGetSlackConfig.mockReturnValue({ signingSecret: TEST_SECRET });
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const timestamp = Math.floor(Date.now() / 1000);
    const result = verifySlackSignature(TEST_BODY, "v0=deadbeef", String(timestamp));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("rejects missing headers", async () => {
    mockGetSlackConfig.mockReturnValue({ signingSecret: TEST_SECRET });
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const result = verifySlackSignature(TEST_BODY, null, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_signature_headers");
  });

  it("rejects stale timestamps", async () => {
    mockGetSlackConfig.mockReturnValue({ signingSecret: TEST_SECRET });
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const old = Math.floor(Date.now() / 1000) - 600;
    const result = verifySlackSignature(
      TEST_BODY,
      sign(TEST_BODY, old, TEST_SECRET),
      String(old),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("timestamp_out_of_tolerance");
  });

  it("fails closed when no signing secret is configured", async () => {
    mockGetSlackConfig.mockReturnValue(null);
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const result = verifySlackSignature(TEST_BODY, null, null);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("no_signing_secret_configured");
  });
});

describe("extractSlackSignatureHeaders", () => {
  it("reads Slack signature headers", async () => {
    const { extractSlackSignatureHeaders } = await import("@/lib/slack/verify");
    const headers = new Headers();
    headers.set("x-slack-signature", "v0=abc");
    headers.set("x-slack-request-timestamp", "123");
    expect(extractSlackSignatureHeaders(headers)).toEqual({
      signature: "v0=abc",
      timestamp: "123",
    });
  });
});
