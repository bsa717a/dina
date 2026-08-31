import { afterEach, describe, expect, it } from "vitest";
import { runWithAuthUser } from "@/lib/auth/context";
import { runWithActiveProject } from "@/lib/chat/active-project";
import type { AuthUser } from "@/lib/auth/types";
import { prisma } from "@/lib/db/client";
import { resolveProjectKey } from "@/lib/project-tasks/keys";
import {
  resetDinaProjectTaskSeedGate,
  seedDinaProjectTasks,
} from "@/lib/project-tasks/seed-dina-tasks";
import {
  addProjectTask,
  completeProjectTask,
  listProjectTasks,
} from "@/lib/project-tasks/store";
import { executeProjectTaskTool } from "@/lib/project-tasks/tools";

afterEach(async () => {
  await prisma.projectTask.deleteMany({
    where: { source: "test" },
  });
  resetDinaProjectTaskSeedGate();
});

async function wipeDinaTasks() {
  await prisma.projectTask.deleteMany({ where: { projectKey: "dina" } });
  resetDinaProjectTaskSeedGate();
}

describe("project key resolution", () => {
  it("resolves fuzzy names to canonical keys", () => {
    expect(resolveProjectKey("Dina")).toBe("dina");
    expect(resolveProjectKey("Dina project")).toBe("dina");
    expect(resolveProjectKey("four student lives")).toBe("4studentlives");
    expect(resolveProjectKey("MetabolicOS")).toBe("metabolicos");
    expect(resolveProjectKey("Hidden Guardians")).toBe("hidden_guardians");
    expect(resolveProjectKey("Reggie")).toBe("regi");
    expect(resolveProjectKey("not-a-real-project")).toBeNull();
  });
});

describe("ProjectTask store", () => {
  it("numbers remaining tasks and completes by number", async () => {
    await addProjectTask({
      project: "beacon",
      title: "Alpha",
      source: "test",
    });
    await addProjectTask({
      project: "beacon",
      title: "Beta",
      source: "test",
    });
    await addProjectTask({
      project: "beacon",
      title: "Gamma",
      source: "test",
    });

    const listed = await listProjectTasks({ project: "Beacon" });
    const created = listed.filter((t) =>
      ["Alpha", "Beta", "Gamma"].includes(t.title),
    );
    expect(created.map((t) => t.title)).toEqual(["Alpha", "Beta", "Gamma"]);

    const beta = listed.find((t) => t.title === "Beta");
    const done = await completeProjectTask({
      project: "beacon",
      number: beta?.number,
    });
    expect(done.title).toBe("Beta");
    expect(done.status).toBe("done");

    const remaining = (await listProjectTasks({ project: "beacon" })).filter(
      (t) => t.source === "test",
    );
    expect(remaining.map((t) => t.title)).toEqual(["Alpha", "Gamma"]);
  });

  it("seeds Dina roadmap idempotently with Waiting On Engine done", async () => {
    await wipeDinaTasks();
    const first = await seedDinaProjectTasks();
    expect(first.created).toBe(11);
    expect(first.updated).toBe(0);

    resetDinaProjectTaskSeedGate();
    const second = await seedDinaProjectTasks();
    expect(second.created).toBe(0);
    expect(second.updated).toBe(11);

    const all = (await listProjectTasks({
      project: "dina",
      includeDone: true,
    })).filter((t) => t.source === "seed");
    expect(all).toHaveLength(11);
    const waiting = all.find((t) => t.title === "Waiting On Engine");
    expect(waiting?.status).toBe("done");

    const remaining = (await listProjectTasks({ project: "dina" })).filter(
      (t) => t.source === "seed",
    );
    expect(remaining).toHaveLength(10);
    expect(remaining.some((t) => t.title === "Waiting On Engine")).toBe(false);
    expect(
      remaining.find((t) => t.title === "GitHub Intelligence")?.status,
    ).toBe("in_progress");
  });

  it("does not clobber completed status on re-seed", async () => {
    await wipeDinaTasks();
    await seedDinaProjectTasks();
    const remaining = await listProjectTasks({ project: "dina" });
    const first = remaining[0];
    await completeProjectTask({ taskId: first.id });

    resetDinaProjectTaskSeedGate();
    await seedDinaProjectTasks();

    const again = await listProjectTasks({
      project: "dina",
      includeDone: true,
    });
    expect(again.find((t) => t.id === first.id)?.status).toBe("done");

    // Restore canonical seed for the running app DB shared with tests.
    await wipeDinaTasks();
    await seedDinaProjectTasks();
  });
});

async function ownerUser(): Promise<AuthUser> {
  const ownerRow = await prisma.user.findFirst({ where: { role: "owner" } });
  if (!ownerRow) throw new Error("Owner must be seeded for project tool tests.");
  return {
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
}

describe("project task tools", () => {
  it("list and complete via tool JSON", async () => {
    await addProjectTask({
      project: "beacon",
      title: "One",
      source: "test",
    });
    await addProjectTask({
      project: "beacon",
      title: "Two",
      source: "test",
    });

    const owner = await ownerUser();
    const listed = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "list_project_tasks",
          JSON.stringify({ project: "Beacon" }),
        ),
      ),
    );
    expect(listed.ok).toBe(true);
    const created = listed.data.tasks.filter((t: { title: string }) =>
      ["One", "Two"].includes(t.title),
    );
    expect(created).toHaveLength(2);
    expect(created[0].id).toBeUndefined();
    expect(created.map((t: { title: string }) => t.title)).toEqual([
      "One",
      "Two",
    ]);

    const one = listed.data.tasks.find((t: { title: string }) => t.title === "One");
    const completed = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "complete_project_task",
          JSON.stringify({ project: "beacon", number: one.number }),
        ),
      ),
    );
    expect(completed.ok).toBe(true);
    expect(completed.data.task.title).toBe("One");
    expect(completed.data.task.id).toBeUndefined();
    expect(completed.data.task.number).toBe(one.number);

    const after = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "list_project_tasks",
          JSON.stringify({ project: "beacon" }),
        ),
      ),
    );
    expect(
      after.data.tasks
        .filter((t: { title: string }) => ["One", "Two"].includes(t.title))
        .map((t: { title: string }) => t.title),
    ).toEqual(["Two"]);
  });

  it("defaults list/add/complete to the selected project", async () => {
    await prisma.projectTask.deleteMany({
      where: { title: { in: ["Sticky one", "Sticky two", "Sticky three"] } },
    });
    await addProjectTask({
      project: "beacon",
      title: "Sticky one",
      source: "test",
    });
    await addProjectTask({
      project: "beacon",
      title: "Sticky two",
      source: "test",
    });

    const owner = await ownerUser();
    const listed = JSON.parse(
      await runWithAuthUser(owner, () =>
        runWithActiveProject({ key: "beacon", name: "Beacon" }, () =>
          executeProjectTaskTool("list_project_tasks", "{}"),
        ),
      ),
    );
    expect(listed.ok).toBe(true);
    expect(listed.data.projectKey).toBe("beacon");
    expect(
      listed.data.tasks.filter((t: { title: string }) =>
        ["Sticky one", "Sticky two"].includes(t.title),
      ),
    ).toHaveLength(2);

    const added = JSON.parse(
      await runWithAuthUser(owner, () =>
        runWithActiveProject({ key: "beacon", name: "Beacon" }, () =>
          executeProjectTaskTool(
            "add_project_task",
            JSON.stringify({ title: "Sticky three" }),
          ),
        ),
      ),
    );
    expect(added.ok).toBe(true);
    expect(added.data.task.projectKey).toBe("beacon");
    expect(added.data.task.title).toBe("Sticky three");
    expect(added.data.task.id).toBeUndefined();
    expect(typeof added.data.task.number).toBe("number");

    const sticky = listed.data.tasks.find(
      (t: { title: string }) => t.title === "Sticky one",
    );
    const completed = JSON.parse(
      await runWithAuthUser(owner, () =>
        runWithActiveProject({ key: "beacon", name: "Beacon" }, () =>
          executeProjectTaskTool(
            "complete_project_task",
            JSON.stringify({ number: sticky.number }),
          ),
        ),
      ),
    );
    expect(completed.ok).toBe(true);

    const missing = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool("list_project_tasks", "{}"),
      ),
    );
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toMatch(/select a project/i);

    await prisma.projectTask.deleteMany({
      where: { title: { in: ["Sticky one", "Sticky two", "Sticky three"] } },
    });
  });

  it("updates a task by project number without exposing an id", async () => {
    const title = `Test update ${Date.now()}`;
    await addProjectTask({
      project: "beacon",
      title,
      source: "test",
    });

    const owner = await ownerUser();
    const listed = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "list_project_tasks",
          JSON.stringify({ project: "beacon" }),
        ),
      ),
    ) as {
      data: { tasks: Array<{ number: number; title: string; id?: string }> };
    };
    const match = listed.data.tasks.find((task) => task.title === title);
    expect(match).toBeTruthy();

    const updated = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "update_project_task",
          JSON.stringify({
            project: "beacon",
            number: match?.number,
            title: `${title} done`,
          }),
        ),
      ),
    );
    expect(updated.ok).toBe(true);
    expect(updated.data.task.title).toBe(`${title} done`);
    expect(updated.data.task.number).toBe(match?.number);
    expect(updated.data.task.id).toBeUndefined();
  });
});
