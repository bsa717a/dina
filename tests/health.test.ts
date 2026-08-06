import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  checkDatabase: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/env", () => ({
  getOpenAIApiKey: () => "sk-test",
  getVapidConfig: () => ({
    publicKey: "pub",
    privateKey: "priv",
    subject: "mailto:test@example.com",
  }),
}));

vi.mock("@/lib/microsoft/graph", () => ({
  checkMicrosoftGraph: vi.fn(async () => ({ ok: true, configured: true })),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns ok when the database is available", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
  });
});
