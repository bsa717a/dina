import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.fn();
const getSession = vi.fn(async () => ({
  authenticated: false,
  save,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: () => getSession(),
}));

vi.mock("@/lib/db/client", () => ({
  checkDatabase: vi.fn(async () => ({ ok: true })),
}));

const authenticateUser = vi.fn();

vi.mock("@/lib/auth/users", () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  needsOnboarding: (user: { role: string; mustChangePassword?: boolean; assistantKey?: string | null }) =>
    user.role === "member" && (Boolean(user.mustChangePassword) || !user.assistantKey),
}));

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

vi.mock("@/lib/auth/rate-limit", () => ({
  getAuthLockoutStatus: () => getAuthLockoutStatus(),
  recordFailedLogin: () => recordFailedLogin(),
  clearAuthFailures: () => clearAuthFailures(),
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

const member = {
  id: "user-alex",
  name: "Alex",
  username: "alex",
  role: "member" as const,
  assistantName: "",
  assistantPersona: "",
  assistantKey: null,
  mustChangePassword: true,
};

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.resetModules();
    save.mockReset();
    getSession.mockClear();
    getAuthLockoutStatus.mockClear();
    recordFailedLogin.mockClear();
    clearAuthFailures.mockClear();
    authenticateUser.mockReset();
  });

  it("rejects an invalid password", async () => {
    authenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "derek", password: "nope" }),
      }) as never,
    );
    expect(res.status).toBe(401);
    expect(recordFailedLogin).toHaveBeenCalled();
  });

  it("sets a session for Derek without onboarding", async () => {
    authenticateUser.mockResolvedValueOnce(owner);
    const session: {
      authenticated: boolean;
      createdAt: number;
      userId?: string;
      role?: string;
      needsOnboarding?: boolean;
      save: typeof save;
    } = { authenticated: false, createdAt: 0, save };
    getSession.mockResolvedValueOnce(session);
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "derek", password: "correct-code" }),
      }) as never,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.needsOnboarding).toBe(false);
    expect(session.authenticated).toBe(true);
    expect(session.userId).toBe("user-derek");
    expect(session.role).toBe("owner");
    expect(session.needsOnboarding).toBe(false);
    expect(save).toHaveBeenCalled();
    expect(clearAuthFailures).toHaveBeenCalled();
  });

  it("flags a new teammate for onboarding", async () => {
    authenticateUser.mockResolvedValueOnce(member);
    const session: {
      authenticated: boolean;
      createdAt: number;
      userId?: string;
      role?: string;
      needsOnboarding?: boolean;
      save: typeof save;
    } = { authenticated: false, createdAt: 0, save };
    getSession.mockResolvedValueOnce(session);
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alex", password: "temporary-password" }),
      }) as never,
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.needsOnboarding).toBe(true);
    expect(session.needsOnboarding).toBe(true);
  });

  it("returns 429 when locked out", async () => {
    getAuthLockoutStatus.mockResolvedValueOnce({
      locked: true,
      failCount: 5,
      retryAfterMs: 60_000,
    });
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "derek", password: "correct-code" }),
      }) as never,
    );
    expect(res.status).toBe(429);
  });
});
