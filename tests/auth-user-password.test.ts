import { beforeEach, describe, expect, it, vi } from "vitest";

const requireReadySession = vi.fn();
const setPasswordForUser = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireReadySession: () => requireReadySession(),
}));

vi.mock("@/lib/auth/users", () => ({
  setPasswordForUser: (...args: unknown[]) => setPasswordForUser(...args),
  PasswordChangeError: class PasswordChangeError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "PasswordChangeError";
      this.status = status;
    }
  },
}));

const owner = {
  id: "user-derek",
  name: "Derek",
  username: "derek",
  role: "owner" as const,
  assistantName: "Dina",
  assistantPersona: "",
  assistantKey: "dina",
  mustChangePassword: false,
};

function post(body: unknown) {
  return new Request("http://localhost:8080/api/team/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/team/password", () => {
  beforeEach(() => {
    vi.resetModules();
    requireReadySession.mockReset();
    setPasswordForUser.mockReset();
    requireReadySession.mockResolvedValue({ ok: true, user: owner });
    setPasswordForUser.mockResolvedValue({ username: "alex", sessionVersion: 2 });
  });

  it("rejects someone who is not the owner", async () => {
    requireReadySession.mockResolvedValue({
      ok: true,
      user: { ...owner, role: "member", username: "alex" },
    });
    const { POST } = await import("@/app/api/team/password/route");
    const res = await POST(post({
      username: "sam",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(403);
    expect(setPasswordForUser).not.toHaveBeenCalled();
  });

  it("rejects a mismatch before saving", async () => {
    const { POST } = await import("@/app/api/team/password/route");
    const res = await POST(post({
      username: "alex",
      newPassword: "replacement-password",
      confirmPassword: "different-password",
    }) as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/do not match/i);
    expect(setPasswordForUser).not.toHaveBeenCalled();
  });

  it("sets the teammate password for the owner", async () => {
    const { POST } = await import("@/app/api/team/password/route");
    const res = await POST(post({
      username: "alex",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, username: "alex" });
    expect(setPasswordForUser).toHaveBeenCalledWith({
      actorId: "user-derek",
      username: "alex",
      newPassword: "replacement-password",
    });
  });

  it("returns the missing-teammate error", async () => {
    const { PasswordChangeError } = await import("@/lib/auth/users");
    setPasswordForUser.mockRejectedValueOnce(
      new PasswordChangeError("No teammate found with that username.", 404),
    );
    const { POST } = await import("@/app/api/team/password/route");
    const res = await POST(post({
      username: "missing",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/no teammate/i);
  });
});
