import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { buildGrokBotWebhookHeaders } from "@/lib/grok-api/webhook-headers";

describe("buildGrokBotWebhookHeaders", () => {
  it("sends only Content-Type when no secret is set", () => {
    expect(buildGrokBotWebhookHeaders("{}", null)).toEqual({
      "Content-Type": "application/json",
    });
    expect(buildGrokBotWebhookHeaders("{}", undefined)).toEqual({
      "Content-Type": "application/json",
    });
    expect(buildGrokBotWebhookHeaders("{}", "")).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("sends Bearer and X-Automation-Key as the primary auth", () => {
    const body = '{"channel":"slack"}';
    const secret = "crsr_test_sender_key";
    const headers = buildGrokBotWebhookHeaders(body, secret);

    expect(headers.Authorization).toBe(`Bearer ${secret}`);
    expect(headers["X-Automation-Key"]).toBe(secret);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Grok-Bot-Signature"]).toBe(
      createHmac("sha256", secret).update(body).digest("hex"),
    );
    expect(headers["X-Grok-Bot-Timestamp"]).toMatch(/^\d+$/);
  });
});
