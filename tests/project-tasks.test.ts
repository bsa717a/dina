import { afterEach, describe, expect, it } from "vitest";
import { runWithAuthUser } from "@/lib/auth/context";
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
    expect(listed.map((t) => t.number)).toEqual([1, 2, 3]);
    expect(listed.map((t) => t.title)).toEqual(["Alpha", "Beta", "Gamma"]);

    const done = await completeProjectTask({ project: "beacon", number: 2 });
    expect(done.title).toBe("Beta");
    expect(done.status).toBe("done");

    const remaining = await listProjectTasks({ project: "beacon" });
    expect(remaining.map((t) => `${t.number}:${t.title}`)).toEqual([
      "1:Alpha",
      "2:Gamma",
    ]);
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
    expect(listed.data.count).toBe(2);

    const completed = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "complete_project_task",
          JSON.stringify({ project: "beacon", number: 1 }),
        ),
      ),
    );
    expect(completed.ok).toBe(true);
    expect(completed.data.task.title).toBe("One");

    const after = JSON.parse(
      await runWithAuthUser(owner, () =>
        executeProjectTaskTool(
          "list_project_tasks",
          JSON.stringify({ project: "beacon" }),
        ),
      ),
    );
    expect(after.data.tasks.map((t: { title: string }) => t.title)).toEqual([
      "Two",
    ]);
  });
});
