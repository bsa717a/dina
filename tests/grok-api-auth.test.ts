import { createHash } from "crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetGrokBotDinaApiToken = vi.fn();
const findUnique = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => mockGetGrokBotDinaApiToken(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

describe("Grok API Auth", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetGrokBotDinaApiToken.mockReset();
    findUnique.mockReset();
    findUnique.mockResolvedValue(null);
  });

  describe("verifyServiceToken", () => {
    it("returns invalid when API token is not configured", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue(undefined);

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects");

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_config");
    });

    it("returns invalid when Authorization header is missing", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects");

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_header");
    });

    it("returns invalid when Authorization header has wrong format", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Basic test-api-token" },
      });

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_token");
    });

    it("returns invalid when token does not match", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("correct-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer wrong-token" },
      });

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_token");
    });

    it("returns valid when token matches", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer test-api-token" },
      });

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("handles case-insensitive Bearer prefix", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "bearer test-api-token" },
      });

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(true);
    });

    it("trims whitespace in token", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer   test-api-token  " },
      });

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(true);
    });

    it("treats the env token as the full-access Dina service", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("dina-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer dina-token" },
      });

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(true);
      if (result.valid) expect(result.actor).toEqual({ kind: "service" });
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("matches a hashed per-user token and returns that user", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("dina-token");
      const token = "adam-user-token";
      const adam = {
        id: "user-adam",
        name: "Adam",
        username: "adam",
        role: "member",
        assistantName: "",
        assistantPersona: "",
        assistantKey: null,
        mustChangePassword: false,
        phoneNumber: "+14352382071",
        sessionVersion: 0,
      };
      findUnique.mockImplementation(async (args: { where?: { grokApiTokenHash?: string } }) => {
        const hash = createHash("sha256").update(token).digest("hex");
        if (args?.where?.grokApiTokenHash === hash) return adam;
        return null;
      });

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const result = await verifyServiceToken(request);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.actor.kind).toBe("user");
        if (result.actor.kind === "user") {
          expect(result.actor.user.id).toBe("user-adam");
          expect(result.actor.user.username).toBe("adam");
        }
      }
    });
  });

  describe("requireServiceToken", () => {
    it("returns ok: true for valid token", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { requireServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer test-api-token" },
      });

      const result = await requireServiceToken(request);

      expect(result.ok).toBe(true);
    });

    it("returns 401 response for missing config", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue(undefined);

      const { requireServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects");

      const result = await requireServiceToken(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
        const body = await result.response.json();
        expect(body.error).toBe("Service not configured");
      }
    });

    it("returns 401 response for invalid token", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("correct-token");

      const { requireServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer wrong-token" },
      });

      const result = await requireServiceToken(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(401);
        const body = await result.response.json();
        expect(body.error).toBe("Invalid or missing service token");
      }
    });
  });

  describe("isGrokApiConfigured", () => {
    it("returns false when token is not set", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue(undefined);

      const { isGrokApiConfigured } = await import("@/lib/grok-api/auth");

      expect(isGrokApiConfigured()).toBe(false);
    });

    it("returns true when token is set", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { isGrokApiConfigured } = await import("@/lib/grok-api/auth");

      expect(isGrokApiConfigured()).toBe(true);
    });
  });
});
