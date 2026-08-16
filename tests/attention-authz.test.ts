import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSession: () => requireSession(),
}));

vi.mock("@/lib/attention/store", () => ({
  listOpenAttentionItems: vi.fn(async () => [{ id: "should-not-see" }]),
}));

describe("Attention API authz", () => {
  beforeEach(() => {
    vi.resetModules();
    requireSession.mockReset();
  });

  it("returns 403 when a member requests Attention", async () => {
    requireSession.mockResolvedValue({
      id: "member-1",
      name: "Alex",
      role: "member",
      username: "alex",
      assistantName: "Nora",
      assistantPersona: "",
      assistantKey: "nora",
      mustChangePassword: false,
    });
    const { GET } = await import("@/app/api/attention/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns 401 when there is no session", async () => {
    requireSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/attention/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
