import { beforeEach, describe, expect, it, vi } from "vitest";

const requireReadySession = vi.fn();
const changePassword = vi.fn();
const authenticateUser = vi.fn();
const save = vi.fn();
const getSession = vi.fn(async () => ({ save }));
const checkDatabase = vi.fn(async () => ({ ok: true }));
const getAuthLockoutStatus = vi.fn(async () => ({
  locked: false,
  failCount: 0,
  retryAfterMs: 0,
}));
const recordFailedLogin = vi.fn(async () => ({
  locked: false,
  failCount: 1,
  retryAfterMs: 0,
}));
const clearAuthFailures = vi.fn(async () => undefined);

vi.mock("@/lib/auth/session", () => ({
  requireReadySession: () => requireReadySession(),
  getSession: () => getSession(),
}));

vi.mock("@/lib/db/client", () => ({
  checkDatabase: () => checkDatabase(),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  getAuthLockoutStatus: () => getAuthLockoutStatus(),
  recordFailedLogin: () => recordFailedLogin(),
  clearAuthFailures: () => clearAuthFailures(),
}));

vi.mock("@/lib/auth/users", () => ({
  changePassword: (...args: unknown[]) => changePassword(...args),
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  needsOnboarding: (user: {
    role: string;
    mustChangePassword?: boolean;
    assistantKey?: string | null;
  }) => user.role === "member" && (Boolean(user.mustChangePassword) || !user.assistantKey),
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
    authenticateUser.mockReset();
    save.mockReset();
    getSession.mockClear();
    checkDatabase.mockClear();
    getAuthLockoutStatus.mockClear();
    recordFailedLogin.mockClear();
    clearAuthFailures.mockClear();
    checkDatabase.mockResolvedValue({ ok: true });
    getAuthLockoutStatus.mockResolvedValue({ locked: false, failCount: 0, retryAfterMs: 0 });
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
    expect(authenticateUser).not.toHaveBeenCalled();
  });

  it("rejects a username that does not match the signed-in account", async () => {
    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      username: "someone-else",
      currentPassword: "current-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(400);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("changes the password from the sign-in page when the current password matches", async () => {
    requireReadySession.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    authenticateUser.mockResolvedValue({ ...user, sessionVersion: 0 });
    changePassword.mockResolvedValue({ sessionVersion: 4 });
    const session: {
      authenticated?: boolean;
      userId?: string;
      role?: string;
      needsOnboarding?: boolean;
      sessionVersion?: number;
      createdAt?: number;
      save: typeof save;
    } = { save };
    getSession.mockResolvedValueOnce(session);

    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      username: "derek",
      currentPassword: "current-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, needsOnboarding: false });
    expect(changePassword).toHaveBeenCalledWith({
      userId: "user-derek",
      currentPassword: "current-password",
      newPassword: "replacement-password",
    });
    expect(session.authenticated).toBe(true);
    expect(session.userId).toBe("user-derek");
    expect(session.sessionVersion).toBe(4);
    expect(session.needsOnboarding).toBe(false);
    expect(clearAuthFailures).toHaveBeenCalled();
  });

  it("does not change the password when the current one is wrong", async () => {
    requireReadySession.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    authenticateUser.mockResolvedValue(null);
    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      username: "derek",
      currentPassword: "wrong-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/incorrect/i);
    expect(changePassword).not.toHaveBeenCalled();
    expect(recordFailedLogin).toHaveBeenCalled();
  });

  it("stops guessing when sign-in is locked", async () => {
    requireReadySession.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });
    getAuthLockoutStatus.mockResolvedValue({
      locked: true,
      failCount: 5,
      retryAfterMs: 1000,
    });
    const { POST } = await import("@/app/api/auth/password/route");
    const res = await POST(post({
      username: "derek",
      currentPassword: "wrong-password",
      newPassword: "replacement-password",
      confirmPassword: "replacement-password",
    }) as never);
    expect(res.status).toBe(429);
    expect(authenticateUser).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });
});
