import { beforeEach, describe, expect, it, vi } from "vitest";

const requestPasswordReset = vi.fn();
const resetPassword = vi.fn();

vi.mock("@/lib/auth/password-reset", () => ({
  forgotPasswordMessage: () =>
    "If that account has an email on file, we sent a reset link. It expires in one hour.",
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
  resetPassword: (...args: unknown[]) => resetPassword(...args),
  ResetPasswordError: class ResetPasswordError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "ResetPasswordError";
      this.status = status;
    }
  },
}));

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => {
    vi.resetModules();
    requestPasswordReset.mockReset();
    requestPasswordReset.mockResolvedValue({ delivered: false });
  });

  it("uses the same reply when no mail is sent", async () => {
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const res = await POST(
      post("http://localhost:8080/api/auth/forgot-password", {
        username: "missing-user",
      }) as never,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.message).toMatch(/email on file/i);
    expect(requestPasswordReset).toHaveBeenCalledWith("missing-user");
  });
});

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.resetModules();
    resetPassword.mockReset();
    resetPassword.mockResolvedValue(undefined);
  });

  it("rejects a mismatched confirmation", async () => {
    const { POST } = await import("@/app/api/auth/reset-password/route");
    const res = await POST(
      post("http://localhost:8080/api/auth/reset-password", {
        token: "token-value",
        newPassword: "replacement-password",
        confirmPassword: "different-password",
      }) as never,
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/do not match/i);
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("returns an invalid-link error", async () => {
    const { ResetPasswordError } = await import("@/lib/auth/password-reset");
    resetPassword.mockRejectedValueOnce(
      new ResetPasswordError("This reset link is invalid or has expired."),
    );
    const { POST } = await import("@/app/api/auth/reset-password/route");
    const res = await POST(
      post("http://localhost:8080/api/auth/reset-password", {
        token: "stale-token",
        newPassword: "replacement-password",
        confirmPassword: "replacement-password",
      }) as never,
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid or has expired/i);
  });

  it("sets the new password for a live token", async () => {
    const { POST } = await import("@/app/api/auth/reset-password/route");
    const res = await POST(
      post("http://localhost:8080/api/auth/reset-password", {
        token: "live-token",
        newPassword: "replacement-password",
        confirmPassword: "replacement-password",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(resetPassword).toHaveBeenCalledWith({
      token: "live-token",
      newPassword: "replacement-password",
    });
  });
});
