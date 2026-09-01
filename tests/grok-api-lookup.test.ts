import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetGrokBotDinaApiToken = vi.fn();
const mockLookupByPhoneNumber = vi.fn();

vi.mock("@/lib/env", () => ({
  getGrokBotDinaApiToken: () => mockGetGrokBotDinaApiToken(),
}));

vi.mock("@/lib/telnyx/roster", () => ({
  lookupByPhoneNumber: (...args: unknown[]) => mockLookupByPhoneNumber(...args),
}));

describe("GET /api/grok/lookup-by-phone", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetGrokBotDinaApiToken.mockReset();
    mockLookupByPhoneNumber.mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");

    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");
    const request = new NextRequest(
      "http://localhost/api/grok/lookup-by-phone?phone=+14352382071",
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Invalid or missing service token");
  });

  it("rejects requests when API is not configured", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue(undefined);

    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");
    const request = new NextRequest(
      "http://localhost/api/grok/lookup-by-phone?phone=+14352382071",
      { headers: { Authorization: "Bearer some-token" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Service not configured");
  });

  it("requires phone query parameter", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");

    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");
    const request = new NextRequest(
      "http://localhost/api/grok/lookup-by-phone",
      { headers: { Authorization: "Bearer test-token" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("phone");
  });

  it("returns user info for known phone numbers", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");
    mockLookupByPhoneNumber.mockResolvedValue({
      found: true,
      user: {
        id: "user-123",
        name: "Adam Bangerter",
        username: "adam",
        phoneNumber: "+14352382071",
      },
      projectKeys: ["4studentlives", "regi"],
    });

    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");
    const request = new NextRequest(
      "http://localhost/api/grok/lookup-by-phone?phone=+14352382071",
      { headers: { Authorization: "Bearer test-token" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.found).toBe(true);
    expect(body.user.id).toBe("user-123");
    expect(body.user.name).toBe("Adam Bangerter");
    expect(body.user.username).toBe("adam");
    expect(body.user.phoneNumber).toBe("+14352382071");
    expect(body.projectKeys).toEqual(["4studentlives", "regi"]);
  });

  it("returns found: false for unknown phone numbers", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");
    mockLookupByPhoneNumber.mockResolvedValue({
      found: false,
      phoneNumber: "+19999999999",
      reason: "unknown_number",
    });

    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");
    const request = new NextRequest(
      "http://localhost/api/grok/lookup-by-phone?phone=+19999999999",
      { headers: { Authorization: "Bearer test-token" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.found).toBe(false);
    expect(body.phoneNumber).toBe("+19999999999");
    expect(body.reason).toBe("unknown_number");
  });

  it("normalizes phone numbers before lookup", async () => {
    mockGetGrokBotDinaApiToken.mockReturnValue("test-token");
    mockLookupByPhoneNumber.mockResolvedValue({
      found: false,
      phoneNumber: "+14352382071",
      reason: "unknown_number",
    });

    const { GET } = await import("@/app/api/grok/lookup-by-phone/route");
    const request = new NextRequest(
      "http://localhost/api/grok/lookup-by-phone?phone=(435)238-2071",
      { headers: { Authorization: "Bearer test-token" } },
    );

    await GET(request);

    expect(mockLookupByPhoneNumber).toHaveBeenCalledWith("(435)238-2071");
  });
});
