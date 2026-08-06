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

vi.mock("@/lib/env", () => ({
  getAccessCode: () => "correct-code",
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

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.resetModules();
    save.mockReset();
    getSession.mockClear();
    getAuthLockoutStatus.mockClear();
    recordFailedLogin.mockClear();
    clearAuthFailures.mockClear();
  });

  it("rejects an invalid access code", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "nope" }),
      }) as never,
    );
    expect(res.status).toBe(401);
    expect(recordFailedLogin).toHaveBeenCalled();
  });

  it("sets a session for a valid access code", async () => {
    const session = { authenticated: false, createdAt: 0, save };
    getSession.mockResolvedValueOnce(session);
    const { POST } = await import("@/app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost:8080/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "correct-code" }),
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(session.authenticated).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(clearAuthFailures).toHaveBeenCalled();
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
        body: JSON.stringify({ code: "correct-code" }),
      }) as never,
    );
    expect(res.status).toBe(429);
  });
});
