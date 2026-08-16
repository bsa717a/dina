import { afterAll, describe, expect, it } from "vitest";
import {
  formatAssistantPersona,
  isMemberAssistantKey,
  listMemberAssistants,
} from "@/lib/assistants/catalog";
import { completeOnboarding, createMember } from "@/lib/auth/users";
import { needsOnboarding } from "@/lib/auth/types";
import { prisma } from "@/lib/db/client";

const stamp = Date.now().toString(36);
let memberId: string | undefined;

afterAll(async () => {
  if (memberId) {
    await prisma.user.delete({ where: { id: memberId } }).catch(() => undefined);
  }
});

describe("assistant catalog", () => {
  it("includes the five teammate personalities", () => {
    const keys = listMemberAssistants().map((a) => a.key);
    expect(keys).toEqual(["nora", "mac", "penny", "addie", "nate"]);
    expect(isMemberAssistantKey("nora")).toBe(true);
    expect(isMemberAssistantKey("dina")).toBe(false);
    expect(formatAssistantPersona(listMemberAssistants()[0])).toContain("Nora");
  });
});

describe("member onboarding", () => {
  it("requires a password change and personality before chat", async () => {
    const member = await createMember({
      name: "Onboard Tester",
      username: `onboard_${stamp}`,
      password: "temporary-password",
      projectKeys: ["4studentlives"],
    });
    memberId = member.id;
    expect(needsOnboarding(member)).toBe(true);

    await expect(
      completeOnboarding({
        userId: member.id,
        password: "short",
        assistantKey: "nora",
      }),
    ).rejects.toThrow(/10 characters/i);

    await expect(
      completeOnboarding({
        userId: member.id,
        password: "new-secure-password",
        assistantKey: "dina",
      }),
    ).rejects.toThrow(/valid assistant/i);

    const done = await completeOnboarding({
      userId: member.id,
      password: "new-secure-password",
      assistantKey: "nora",
    });
    expect(needsOnboarding(done)).toBe(false);
    expect(done.assistantKey).toBe("nora");
    expect(done.assistantName).toBe("Nora");
    expect(done.mustChangePassword).toBe(false);
  });
});
