import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithAuthUser } from "@/lib/auth/context";
import { createMember } from "@/lib/auth/users";
import type { AuthUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db/client";
import {
  getConversationWithMessages,
  getOrCreateDefaultConversation,
} from "@/lib/db/conversations";
import { userCanAccessProject } from "@/lib/project-tasks/membership";
import { executeTeamTool } from "@/lib/team/tools";
import { memberCanAccessMemory, memoryScopeForUser } from "@/lib/memory/scope";
import { retrieveRelevantMemories } from "@/lib/memory/retrieve";
import { createOrCorrectMemory } from "@/lib/memory/store";
import { addProjectTask } from "@/lib/project-tasks/store";
import { executeProjectTaskTool } from "@/lib/project-tasks/tools";

const CODE = `test-member-${Date.now()}`;
let member: AuthUser;
let owner: AuthUser;

beforeAll(async () => {
  const ownerRow = await prisma.user.findFirst({ where: { role: "owner" } });
  if (!ownerRow) throw new Error("Owner must be seeded for authz tests.");
  owner = {
    id: ownerRow.id,
    name: ownerRow.name,
    username: ownerRow.username,
    role: "owner",
    assistantName: ownerRow.assistantName,
    assistantPersona: ownerRow.assistantPersona,
    assistantKey: ownerRow.assistantKey,
    mustChangePassword: ownerRow.mustChangePassword,
    phoneNumber: ownerRow.phoneNumber ?? null,
  };
  member = await createMember({
    name: "Test Teammate",
    username: `test_${Date.now().toString(36)}`,
    password: `${CODE}-password`,
    projectKeys: ["4studentlives"],
  });
});

afterAll(async () => {
  if (member?.id) {
    await prisma.user.delete({ where: { id: member.id } }).catch(() => undefined);
  }
  await prisma.projectTask.deleteMany({
    where: { source: "authz-test" },
  });
});

describe("project membership", () => {
  it("lets a member use assigned projects only", async () => {
    expect(await userCanAccessProject(member, "4studentlives")).toBe(
      "4studentlives",
    );
    expect(await userCanAccessProject(member, "dina")).toBeNull();
    expect(await userCanAccessProject(owner, "dina")).toBe("dina");
  });

  it("lets the owner add an existing teammate to another project", async () => {
    expect(await userCanAccessProject(member, "regi")).toBeNull();
    const result = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeTeamTool(
          "add_teammate_to_project",
          JSON.stringify({ person: member.username, projects: ["Regi"] }),
        ),
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.data.added).toContain("Regi");
    expect(await userCanAccessProject(member, "regi")).toBe("regi");
  });

  it("gates project task tools for members", async () => {
    await addProjectTask({
      project: "4studentlives",
      title: `Authz 4SL ${CODE}`,
      source: "authz-test",
    });
    await addProjectTask({
      project: "dina",
      title: `Authz Dina ${CODE}`,
      source: "authz-test",
    });

    const allowed = JSON.parse(
      await runWithAuthUser(member, () =>
        executeProjectTaskTool(
          "list_project_tasks",
          JSON.stringify({ project: "4StudentLives" }),
        ),
      ),
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.data.projectKey).toBe("4studentlives");

    const denied = JSON.parse(
      await runWithAuthUser(member, () =>
        executeProjectTaskTool(
          "list_project_tasks",
          JSON.stringify({ project: "Dina" }),
        ),
      ),
    );
    expect(denied.ok).toBe(false);
    expect(String(denied.error)).toMatch(/no access/i);

    const ownerList = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "list_project_tasks",
          JSON.stringify({ project: "Dina" }),
        ),
      ),
    );
    expect(ownerList.ok).toBe(true);
  });
});

describe("conversation isolation", () => {
  it("does not let a member load the owner's conversation", async () => {
    const ownerConvo = await getOrCreateDefaultConversation(owner.id, "Dina");
    const memberConvo = await getOrCreateDefaultConversation(member.id, "Assistant");
    expect(memberConvo.id).not.toBe(ownerConvo.id);
    expect(memberConvo.title).toBe("Assistant");

    const leaked = await getConversationWithMessages({
      userId: member.id,
      conversationId: ownerConvo.id,
    });
    expect(leaked).toBeNull();

    const own = await getConversationWithMessages({
      userId: member.id,
      conversationId: memberConvo.id,
    });
    expect(own?.conversation.id).toBe(memberConvo.id);
  });
});

describe("memory visibility", () => {
  it("does not show owner private-category memories to members via projectKey", async () => {
    const stamp = Date.now().toString(36);
    const privateMemory = await createOrCorrectMemory({
      category: "family",
      title: `Private family ${stamp}`,
      content: "Do not share this with teammates.",
      source: "test",
      confidence: 0.9,
      projectKey: "4studentlives",
    });
    const sharedMemory = await createOrCorrectMemory({
      category: "projects",
      title: `Shared project ${stamp}`,
      content: "This is project context for teammates.",
      source: "test",
      confidence: 0.9,
      projectKey: "4studentlives",
    });

    const scope = await memoryScopeForUser(member);
    const found = await retrieveRelevantMemories(
      `private family teammates project ${stamp}`,
      { scope, limit: 20 },
    );
    const ids = found.map((row) => row.id);
    expect(ids).not.toContain(privateMemory.id);
    expect(ids).toContain(sharedMemory.id);

    await prisma.memoryItem.deleteMany({
      where: { id: { in: [privateMemory.id, sharedMemory.id] } },
    });
  });

  it("requires a shared category for project-scoped member access", async () => {
    const scope = await memoryScopeForUser(member);
    expect(
      memberCanAccessMemory(
        {
          ownerUserId: owner.id,
          projectKey: "4studentlives",
          category: "family",
        },
        scope,
      ),
    ).toBe(false);
    expect(
      memberCanAccessMemory(
        {
          ownerUserId: owner.id,
          projectKey: "4studentlives",
          category: "projects",
        },
        scope,
      ),
    ).toBe(true);
  });
});
