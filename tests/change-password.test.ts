import { afterAll, describe, expect, it } from "vitest";
import {
  authenticateUser,
  changePassword,
  createMember,
  PasswordChangeError,
  setPasswordForUser,
} from "@/lib/auth/users";
import { prisma } from "@/lib/db/client";

const stamp = Date.now().toString(36);
const username = `pwchange_${stamp}`;
const memberIds: string[] = [];
let createdOwnerId: string | undefined;

afterAll(async () => {
  for (const id of memberIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  if (createdOwnerId) {
    await prisma.user.delete({ where: { id: createdOwnerId } }).catch(() => undefined);
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
    memberIds.push(member.id);

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

  it("lets the owner set a teammate password without the current one", async () => {
    let owner = await prisma.user.findFirst({ where: { role: "owner" } });
    if (!owner) {
      const { hashPassword } = await import("@/lib/auth/password");
      owner = await prisma.user.create({
        data: {
          name: "Derek",
          username: `owner_${stamp}`,
          role: "owner",
          assistantName: "Dina",
          assistantPersona: "",
          assistantKey: "dina",
          passwordHash: hashPassword("owner-password-1"),
          mustChangePassword: false,
        },
      });
      createdOwnerId = owner.id;
    }
    const member = await createMember({
      name: "Password Tester",
      username: `${username}_mate`,
      password: "temporary-password",
      projectKeys: ["4studentlives"],
    });
    memberIds.push(member.id);

    await setPasswordForUser({
      actorId: owner!.id,
      username: member.username,
      newPassword: "admin-set-password",
    });

    expect(await authenticateUser(member.username, "temporary-password")).toBeNull();
    const signedIn = await authenticateUser(member.username, "admin-set-password");
    expect(signedIn?.id).toBe(member.id);
    expect(signedIn?.mustChangePassword).toBe(false);

    await expect(
      setPasswordForUser({
        actorId: member.id,
        username: member.username,
        newPassword: "another-password",
      }),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      setPasswordForUser({
        actorId: owner!.id,
        username: "derek",
        newPassword: "another-password",
      }),
    ).rejects.toMatchObject({ status: 404 });
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
