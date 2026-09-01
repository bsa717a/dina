import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetGrokBotDinaApiToken = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => mockGetGrokBotDinaApiToken(),
}));

describe("Grok API Auth", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetGrokBotDinaApiToken.mockReset();
  });

  describe("verifyServiceToken", () => {
    it("returns invalid when API token is not configured", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue(undefined);

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects");

      const result = verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_config");
    });

    it("returns invalid when Authorization header is missing", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects");

      const result = verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing_header");
    });

    it("returns invalid when Authorization header has wrong format", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Basic test-api-token" },
      });

      const result = verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_token");
    });

    it("returns invalid when token does not match", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("correct-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer wrong-token" },
      });

      const result = verifyServiceToken(request);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_token");
    });

    it("returns valid when token matches", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer test-api-token" },
      });

      const result = verifyServiceToken(request);

      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("handles case-insensitive Bearer prefix", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "bearer test-api-token" },
      });

      const result = verifyServiceToken(request);

      expect(result.valid).toBe(true);
    });

    it("trims whitespace in token", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { verifyServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer   test-api-token  " },
      });

      const result = verifyServiceToken(request);

      expect(result.valid).toBe(true);
    });
  });

  describe("requireServiceToken", () => {
    it("returns ok: true for valid token", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue("test-api-token");

      const { requireServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects", {
        headers: { Authorization: "Bearer test-api-token" },
      });

      const result = requireServiceToken(request);

      expect(result.ok).toBe(true);
    });

    it("returns 401 response for missing config", async () => {
      mockGetGrokBotDinaApiToken.mockReturnValue(undefined);

      const { requireServiceToken } = await import("@/lib/grok-api/auth");
      const request = new NextRequest("http://localhost/api/grok/projects");

      const result = requireServiceToken(request);

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

      const result = requireServiceToken(request);

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
