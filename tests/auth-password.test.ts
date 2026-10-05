import { beforeEach, describe, expect, it, vi } from "vitest";

const requireReadySession = vi.fn();
const changePassword = vi.fn();
const save = vi.fn();
const getSession = vi.fn(async () => ({ save }));

vi.mock("@/lib/auth/session", () => ({
  requireReadySession: () => requireReadySession(),
  getSession: () => getSession(),
}));

vi.mock("@/lib/auth/users", () => ({
  changePassword: (...args: unknown[]) => changePassword(...args),
  PasswordChangeError: class PasswordChangeError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "PasswordChangeError";
      this.status = status;
    }
  },
}));

const user = {
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
  return new Request("http://localhost:8080/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/password", () => {
  beforeEach(() => {
    vi.resetModules();
    requireReadySession.mockReset();
    changePassword.mockReset();
    save.mockReset();
    getSession.mockClear();
    requireReadySession.mockResolvedValue({ ok: true, user });
    changePassword.mockResolvedValue({ sessionVersion: 1 });
  });

  it("requires a signed-in user", async () => {
    requireReadySession.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      currentPassword: "current-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("rejects a mismatch before touching the stored password", async () => {
    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      currentPassword: "current-password",
      newPassword: "replacement-password",
      confirmPassword: "different-password",
    }) as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/do not match/i);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("returns the current-password error from the auth layer", async () => {
    const { PasswordChangeError } = await import("@/lib/auth/users");
    changePassword.mockRejectedValueOnce(
      new PasswordChangeError("Current password is incorrect.", 401),
    );
    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      currentPassword: "wrong-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/incorrect/i);
  });

  it("updates the password for the signed-in user", async () => {
    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      currentPassword: "current-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(200);
    expect(changePassword).toHaveBeenCalledWith({
      userId: "user-derek",
      currentPassword: "current-password",
      newPassword: "replacement-password",
    });
  });
});
