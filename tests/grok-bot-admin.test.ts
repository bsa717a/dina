import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decryptField } from "@/lib/crypto/field-cipher";

const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

describe("issueUserGrokBotCredentials", () => {
  beforeEach(() => {
    vi.resetModules();
    findUnique.mockReset();
    update.mockReset();
    process.env.SESSION_SECRET = "test-session-secret-test-session-secret";
    update.mockResolvedValue({});
  });

  it("stores an encrypted secret and a token hash, and returns the token once", async () => {
    findUnique.mockResolvedValue({ id: "user-adam", username: "adam" });
    const { issueUserGrokBotCredentials } = await import("@/lib/grok-api/bots");

    const result = await issueUserGrokBotCredentials({
      username: "Adam",
      webhookUrl: "https://adam.example/webhook",
      webhookSecret: "crsr_adam_secret",
    });

    expect(result.token.startsWith("grk_")).toBe(true);
    expect(result.username).toBe("adam");
    expect(result.webhookUrl).toBe("https://adam.example/webhook");

    const data = update.mock.calls[0][0].data as {
      grokWebhookUrl: string;
      grokWebhookSecret: string;
      grokApiTokenHash: string;
    };
    expect(data.grokWebhookUrl).toBe("https://adam.example/webhook");
    expect(data.grokWebhookSecret).not.toBe("crsr_adam_secret");
    expect(data.grokWebhookSecret.startsWith("aes-256-gcm:v1:")).toBe(true);
    expect(decryptField(data.grokWebhookSecret)).toBe("crsr_adam_secret");
    expect(data.grokApiTokenHash).not.toBe(result.token);
    expect(data.grokApiTokenHash).toBe(
      createHash("sha256").update(result.token).digest("hex"),
    );
    expect(JSON.stringify(data)).not.toContain(result.token);
    expect(JSON.stringify(data)).not.toContain("crsr_adam_secret");
  });

  it("rejects a missing user and a non-http webhook", async () => {
    findUnique.mockResolvedValue(null);
    const { issueUserGrokBotCredentials } = await import("@/lib/grok-api/bots");

    await expect(
      issueUserGrokBotCredentials({
        username: "missing",
        webhookUrl: "https://adam.example/webhook",
        webhookSecret: "crsr_secret",
      }),
    ).rejects.toThrow(/No Piper user/);

    findUnique.mockResolvedValue({ id: "user-adam", username: "adam" });
    await expect(
      issueUserGrokBotCredentials({
        username: "adam",
        webhookUrl: "javascript:alert(1)",
        webhookSecret: "crsr_secret",
      }),
    ).rejects.toThrow(/http/);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("field cipher", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret-test-session-secret";
  });

  it("round-trips a webhook secret and rejects a different key", async () => {
    const { encryptField, decryptField: decrypt } = await import("@/lib/crypto/field-cipher");
    const stored = encryptField("crsr_roundtrip");
    expect(stored).not.toContain("crsr_roundtrip");
    expect(decrypt(stored)).toBe("crsr_roundtrip");

    process.env.SESSION_SECRET = "a-different-session-secret-value!!";
    expect(decrypt(stored)).toBeNull();
    expect(decrypt("not-ciphertext")).toBeNull();
  });
});
