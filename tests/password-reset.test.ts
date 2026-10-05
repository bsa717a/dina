import { afterAll, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { authenticateUser, createMember } from "@/lib/auth/users";
import {
  buildResetEmail,
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth/password-reset";
import { prisma } from "@/lib/db/client";

const stamp = Date.now().toString(36);
const userIds: string[] = [];

afterAll(async () => {
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }
});

function tokenFromBody(body: string): string {
  const line = body.split("\n").find((part) => part.includes("token="));
  if (!line) throw new Error("Reset email did not include a link.");
  return new URL(line.trim()).searchParams.get("token") || "";
}

describe("password reset", () => {
  it("describes a one-hour link without the password", () => {
    const message = buildResetEmail({
      username: "alex",
      resetUrl: "https://dina.example/reset-password?token=abc",
    });
    expect(message.subject).toBe("Reset your Dina password");
    expect(message.body).toContain("alex");
    expect(message.body).toContain("https://dina.example/reset-password?token=abc");
    expect(message.body).not.toMatch(/temporary password/i);
  });

  it("sends one link and rejects the token after it is used", async () => {
    const username = `reset_${stamp}`;
    const member = await createMember({
      name: "Reset Tester",
      username,
      password: "temporary-password",
      projectKeys: ["4studentlives"],
      email: `${username}@example.com`,
    });
    userIds.push(member.id);

    const sendMail = vi.fn(async (_input: { to: string; subject: string; body: string }) => undefined);
    const sent = await requestPasswordReset(username, {
      sendMail,
      mailConfigured: true,
    });
    expect(sent.delivered).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const payload = sendMail.mock.calls[0][0];
    expect(payload.to).toBe(`${username}@example.com`);

    const token = tokenFromBody(payload.body);
    await resetPassword({ token, newPassword: "replacement-password" });
    expect(await authenticateUser(username, "temporary-password")).toBeNull();
    const signedIn = await authenticateUser(username, "replacement-password");
    expect(signedIn?.id).toBe(member.id);
    expect(signedIn?.mustChangePassword).toBe(false);

    await expect(
      resetPassword({ token, newPassword: "another-password-ok" }),
    ).rejects.toThrow(/invalid or has expired/i);
  });

  it("answers the same way when the username is unknown", async () => {
    const sendMail = vi.fn(async () => undefined);
    const sent = await requestPasswordReset(`missing_${stamp}`, {
      sendMail,
      mailConfigured: true,
    });
    expect(sent.delivered).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("stops after three emails in an hour", async () => {
    const username = `limit_${stamp}`;
    const member = await createMember({
      name: "Limit Tester",
      username,
      password: "temporary-password",
      projectKeys: ["4studentlives"],
      email: `${username}@example.com`,
    });
    userIds.push(member.id);
    const sendMail = vi.fn(async () => undefined);
    for (let i = 0; i < 3; i += 1) {
      const sent = await requestPasswordReset(username, { sendMail, mailConfigured: true });
      expect(sent.delivered).toBe(true);
    }
    const blocked = await requestPasswordReset(username, { sendMail, mailConfigured: true });
    expect(blocked.delivered).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it("uses the owner fallback inbox when the account has no email", async () => {
    const username = `owner_${stamp}`;
    const member = await createMember({
      name: "Owner Tester",
      username,
      password: "temporary-password",
      projectKeys: ["dina"],
    });
    userIds.push(member.id);
    await prisma.user.update({
      where: { id: member.id },
      data: { role: "owner", email: null },
    });
    const previous = process.env.OWNER_EMAIL;
    process.env.OWNER_EMAIL = `${username}@example.com`;
    try {
      const sendMail = vi.fn(async (_input: { to: string; subject: string; body: string }) => undefined);
      const sent = await requestPasswordReset(username, { sendMail, mailConfigured: true });
      expect(sent.delivered).toBe(true);
      expect(sendMail.mock.calls[0][0].to).toBe(`${username}@example.com`);
      const stored = await prisma.user.findUnique({ where: { id: member.id } });
      expect(stored?.email).toBe(`${username}@example.com`);
    } finally {
      if (previous === undefined) delete process.env.OWNER_EMAIL;
      else process.env.OWNER_EMAIL = previous;
    }
  });

  it("rejects an expired token", async () => {
    const username = `expired_${stamp}`;
    const member = await createMember({
      name: "Expired Tester",
      username,
      password: "temporary-password",
      projectKeys: ["4studentlives"],
      email: `${username}@example.com`,
    });
    userIds.push(member.id);
    const token = `expired-token-${stamp}`;
    await prisma.passwordReset.create({
      data: {
        userId: member.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    await expect(
      resetPassword({ token, newPassword: "replacement-password" }),
    ).rejects.toThrow(/invalid or has expired/i);
    expect(await authenticateUser(username, "temporary-password")).toBeTruthy();
  });
});
