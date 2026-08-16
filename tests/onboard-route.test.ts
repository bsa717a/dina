import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.fn();
const getSession = vi.fn();
const completeOnboarding = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireSession: () => requireSession(),
  getSession: () => getSession(),
}));

vi.mock("@/lib/auth/users", () => ({
  completeOnboarding: (...args: unknown[]) => completeOnboarding(...args),
  needsOnboarding: (user: { role: string; mustChangePassword?: boolean; assistantKey?: string | null }) =>
    user.role === "member" && (Boolean(user.mustChangePassword) || !user.assistantKey),
}));

describe("POST /api/auth/onboard", () => {
  beforeEach(() => {
    vi.resetModules();
    requireSession.mockReset();
    getSession.mockReset();
    completeOnboarding.mockReset();
  });

  it("rejects the owner", async () => {
    requireSession.mockResolvedValue({
      id: "owner",
      role: "owner",
      mustChangePassword: false,
      assistantKey: "dina",
    });
    const { POST } = await import("@/app/api/auth/onboard/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "new-secure-password",
          confirmPassword: "new-secure-password",
          assistantKey: "nora",
        }),
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("completes teammate onboarding", async () => {
    requireSession.mockResolvedValue({
      id: "member-1",
      role: "member",
      mustChangePassword: true,
      assistantKey: null,
    });
    const save = vi.fn();
    getSession.mockResolvedValue({ needsOnboarding: true, save });
    completeOnboarding.mockResolvedValue({
      id: "member-1",
      role: "member",
      assistantName: "Nora",
      assistantKey: "nora",
    });
    const { POST } = await import("@/app/api/auth/onboard/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "new-secure-password",
          confirmPassword: "new-secure-password",
          assistantKey: "nora",
        }),
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(completeOnboarding).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("clears a stale onboarding session when setup is already done", async () => {
    requireSession.mockResolvedValue({
      id: "member-1",
      name: "Alex",
      role: "member",
      mustChangePassword: false,
      assistantKey: "nora",
      assistantName: "Nora",
    });
    const save = vi.fn();
    getSession.mockResolvedValue({ needsOnboarding: true, save });
    const { POST } = await import("@/app/api/auth/onboard/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "new-secure-password",
          confirmPassword: "new-secure-password",
          assistantKey: "nora",
        }),
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });
});
