import { afterAll, describe, expect, it } from "vitest";
import { authenticateUser, changePassword, createMember, PasswordChangeError } from "@/lib/auth/users";
import { prisma } from "@/lib/db/client";

const stamp = Date.now().toString(36);
const username = `pwchange_${stamp}`;
let memberId: string | undefined;

afterAll(async () => {
  if (memberId) {
    await prisma.user.delete({ where: { id: memberId } }).catch(() => undefined);
  }
});

describe("changePassword", () => {
  it("replaces the password when the current one matches", async () => {
    const member = await createMember({
      name: "Password Tester",
      username,
      password: "temporary-password",
      projectKeys: ["4studentlives"],
    });
    memberId = member.id;

    await expect(
      changePassword({
        userId: member.id,
        currentPassword: "wrong-password",
        newPassword: "replacement-password",
      }),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      changePassword({
        userId: member.id,
        currentPassword: "temporary-password",
        newPassword: "short",
      }),
    ).rejects.toThrow(/10 characters/i);

    await expect(
      changePassword({
        userId: member.id,
        currentPassword: "temporary-password",
        newPassword: "temporary-password",
      }),
    ).rejects.toThrow(/different/i);

    await changePassword({
      userId: member.id,
      currentPassword: "temporary-password",
      newPassword: "replacement-password",
    });

    expect(await authenticateUser(username, "temporary-password")).toBeNull();
    const signedIn = await authenticateUser(username, "replacement-password");
    expect(signedIn?.id).toBe(member.id);
    expect(signedIn?.mustChangePassword).toBe(false);
  });

  it("uses PasswordChangeError for a missing user", async () => {
    await expect(
      changePassword({
        userId: "missing-user",
        currentPassword: "temporary-password",
        newPassword: "replacement-password",
      }),
    ).rejects.toBeInstanceOf(PasswordChangeError);
  });
});
