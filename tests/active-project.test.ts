import { describe, expect, it } from "vitest";
import {
  getActiveProject,
  projectArgOrActive,
  projectNamesFromArgsOrActive,
  runWithActiveProject,
} from "@/lib/chat/active-project";
import { formatActiveProjectRuntime, getMemberSystemPrompt } from "@/lib/ai/prompt";
import {
  formatRemainingTaskLines,
  formatRemainingTasksMessage,
  formatRemainingTasksRuntime,
  formatRemainingTasksSnapshot,
  isRemainingTasksChatContent,
  projectKeyFromTaskToolOutput,
} from "@/lib/project-tasks/format";

describe("active project context", () => {
  it("defaults tool args to the selected project and allows an override", () => {
    expect(() => projectArgOrActive({})).toThrow(/select a project/i);

    runWithActiveProject({ key: "dina", name: "Dina" }, () => {
      expect(getActiveProject()).toEqual({ key: "dina", name: "Dina" });
      expect(projectArgOrActive({})).toBe("dina");
      expect(projectArgOrActive({ project: " Beacon " })).toBe("Beacon");
      expect(projectNamesFromArgsOrActive({})).toEqual(["Dina"]);
      expect(projectNamesFromArgsOrActive({ projects: ["Regi"] })).toEqual([
        "Regi",
      ]);
    });

    expect(getActiveProject()).toBeNull();
  });

  it("tells the model to keep project work on the selected project", () => {
    const runtime = formatActiveProjectRuntime({ key: "dina", name: "Dina" });
    expect(runtime).toContain("Active project: Dina");
    expect(runtime).toContain("Do not ask which project to add a task to");
    expect(runtime).toContain("not an older list in chat history");
    expect(formatActiveProjectRuntime(null)).toBe("");

    const member = getMemberSystemPrompt({
      userName: "Alex",
      assistantName: "Nova",
      assistantPersona: "",
      projectNames: ["Dina", "Beacon"],
      activeProject: { key: "dina", name: "Dina" },
    });
    expect(member).toContain("Assigned projects: Dina, Beacon");
    expect(member).toContain("Active project: Dina");
    expect(member).toContain("Remaining tasks in SESSION RUNTIME");
  });
});

describe("remaining task runtime", () => {
  const task = {
    id: "t1",
    projectKey: "dina",
    title: "Ship the selector",
    description: "",
    status: "open" as const,
    sortOrder: 0,
    source: "test",
    createdByUserId: null,
    assigneeUserId: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    number: 1,
  };

  it("puts remaining tasks in session runtime so the model can recite them", () => {
    const runtime = formatRemainingTasksRuntime([
      { projectKey: "dina", projectName: "Dina", tasks: [task] },
    ]);
    expect(runtime).toContain("already loaded");
    expect(runtime).toContain("1. [open] Ship the selector");
    expect(runtime).toContain("Do not call list_project_tasks just to read it");
    expect(runtime).toContain("Never show task IDs");
    expect(formatRemainingTasksRuntime([])).toBe("");
    const empty = formatRemainingTasksRuntime([
      { projectKey: "regi", projectName: "Regi", tasks: [] },
    ]);
    expect(empty).toContain("(none remaining)");
    expect(empty).toContain("There is no task #1 on Regi");
  });

  it("formats a user-facing remaining list without a model", () => {
    expect(
      formatRemainingTasksMessage({
        projectKey: "dina",
        projectName: "Dina",
        tasks: [task],
      }),
    ).toBe("Remaining tasks for Dina:\n\n1. Ship the selector");
    expect(
      formatRemainingTasksMessage({
        projectKey: "dina",
        projectName: "Dina",
        tasks: [],
      }),
    ).toBe("No remaining tasks for Dina.");
  });

  it("formats a one-line remaining snapshot for the composer strip", () => {
    expect(
      formatRemainingTasksSnapshot({
        projectName: "Regi",
        tasks: [],
      }),
    ).toBe("Regi — nothing waiting.");
    expect(
      formatRemainingTasksSnapshot({
        projectName: "Dina",
        tasks: [task],
      }),
    ).toBe("Dina — 1 remaining. Next: Ship the selector.");
    expect(
      formatRemainingTasksSnapshot({
        projectName: "Dina",
        tasks: [task, { ...task, id: "t2", number: 2, title: "Write the strip" }],
      }),
    ).toBe("Dina — 2 remaining. Next: Ship the selector.");
    expect(formatRemainingTaskLines([task])).toEqual(["1. Ship the selector"]);
  });

  it("recognizes leftover remaining-task chat and written project keys", () => {
    expect(
      isRemainingTasksChatContent("user", "Show remaining tasks for Dina"),
    ).toBe(true);
    expect(
      isRemainingTasksChatContent(
        "assistant",
        "Remaining tasks for Dina:\n\n1. Ship the selector",
      ),
    ).toBe(true);
    expect(
      isRemainingTasksChatContent(
        "assistant",
        "Remaining project tasks (live this turn — already loaded):\nDina:\n1. [open] Ship the selector",
      ),
    ).toBe(true);
    expect(
      isRemainingTasksChatContent(
        "assistant",
        "Current 4StudentLives backlog (remaining/open tasks)\n\n- Chico",
      ),
    ).toBe(true);
    expect(
      isRemainingTasksChatContent("assistant", "Regi — no remaining tasks."),
    ).toBe(true);
    expect(isRemainingTasksChatContent("user", "mark 2 complete")).toBe(false);
    expect(
      projectKeyFromTaskToolOutput(
        JSON.stringify({ ok: true, data: { task: { projectKey: "beacon" } } }),
      ),
    ).toBe("beacon");
  });
});
