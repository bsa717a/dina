import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SlackRosterLookupResult } from "@/lib/slack/types";

const mockListProjectTasks = vi.fn();
const mockAddProjectTask = vi.fn();
const mockCompleteProjectTask = vi.fn();

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: (...args: unknown[]) => mockListProjectTasks(...args),
  addProjectTask: (...args: unknown[]) => mockAddProjectTask(...args),
  completeProjectTask: (...args: unknown[]) => mockCompleteProjectTask(...args),
}));

vi.mock("@/lib/slack/scope", () => ({
  resolveRegiProjectKey: () => "regi",
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const roster: Extract<SlackRosterLookupResult, { found: true }> = {
  found: true,
  user: { id: "u-mo", name: "Mo", username: "mo", slackUserId: "U0C119F6538" },
  projectKeys: ["regi"],
  onRegiProject: true,
};

function task(partial: {
  id: string;
  number: number;
  title: string;
  assigneeUserId?: string | null;
}) {
  return {
    id: partial.id,
    projectKey: "regi",
    title: partial.title,
    description: "",
    status: "open" as const,
    sortOrder: partial.number,
    source: "chat",
    createdByUserId: null,
    assigneeUserId: partial.assigneeUserId ?? null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    number: partial.number,
  };
}

describe("parsePiperCommand", () => {
  it("routes tasks and list as structured list commands", async () => {
    const { parsePiperCommand } = await import("@/lib/slack/command");
    expect(parsePiperCommand("tasks").verb).toBe("list");
    expect(parsePiperCommand("list").verb).toBe("list");
    expect(parsePiperCommand("/piper tasks").verb).toBe("list");
    expect(parsePiperCommand("/piper list").verb).toBe("list");
  });

  it("routes add and done without English phrase matching", async () => {
    const { parsePiperCommand } = await import("@/lib/slack/command");
    expect(parsePiperCommand("add Call the vendor")).toEqual({
      verb: "add",
      title: "Call the vendor",
      raw: "add Call the vendor",
    });
    expect(parsePiperCommand("done 3")).toEqual({
      verb: "done",
      number: 3,
      raw: "done 3",
    });
    expect(parsePiperCommand("done #12")).toEqual({
      verb: "done",
      number: 12,
      raw: "done #12",
    });
  });

  it("does not treat free-text list asks as commands", async () => {
    const { parsePiperCommand, isStructuredPiperCommand } = await import(
      "@/lib/slack/command"
    );
    for (const text of [
      "show me all tasks",
      "what are my tasks",
      "please list remaining tasks",
      "ship the dashboard polish",
    ]) {
      expect(isStructuredPiperCommand(parsePiperCommand(text))).toBe(false);
    }
  });

  it("parses split slash-command names", async () => {
    const { parseSlackSlashPayload } = await import("@/lib/slack/command");
    expect(parseSlackSlashPayload("/piper-tasks", "").verb).toBe("list");
    expect(parseSlackSlashPayload("/piper-add", "Book studio").title).toBe(
      "Book studio",
    );
    expect(parseSlackSlashPayload("/piper-done", "4").number).toBe(4);
    expect(parseSlackSlashPayload("/piper", "tasks").verb).toBe("list");
  });
});

describe("processPiperCommand", () => {
  beforeEach(() => {
    vi.resetModules();
    mockListProjectTasks.mockReset();
    mockAddProjectTask.mockReset();
    mockCompleteProjectTask.mockReset();
  });

  it("lists only tasks assigned to the mapped Slack user", async () => {
    mockListProjectTasks.mockResolvedValue([
      task({ id: "t1", number: 1, title: "Gabe review", assigneeUserId: "u-gabe" }),
      task({ id: "t2", number: 2, title: "Mo polish", assigneeUserId: "u-mo" }),
      task({ id: "t3", number: 3, title: "Unassigned" }),
    ]);

    const { parsePiperCommand, processPiperCommand } = await import(
      "@/lib/slack/command"
    );
    const result = await processPiperCommand({
      parsed: parsePiperCommand("tasks"),
      roster,
    });

    expect(result.kind).toBe("command_list");
    expect(result.text).toContain("Mo polish");
    expect(result.text).toContain("2. Mo polish");
    expect(result.text).not.toContain("Gabe review");
    expect(result.text).not.toContain("Unassigned");
    expect(mockListProjectTasks).toHaveBeenCalledWith({ project: "regi" });
    expect(mockAddProjectTask).not.toHaveBeenCalled();
  });

  it("creates a Regi task assigned to the mapped user", async () => {
    mockAddProjectTask.mockResolvedValue(
      task({ id: "t-new", number: 0, title: "Call the vendor", assigneeUserId: "u-mo" }),
    );
    mockListProjectTasks.mockResolvedValue([
      task({ id: "t-new", number: 4, title: "Call the vendor", assigneeUserId: "u-mo" }),
    ]);

    const { parsePiperCommand, processPiperCommand } = await import(
      "@/lib/slack/command"
    );
    const result = await processPiperCommand({
      parsed: parsePiperCommand("add Call the vendor"),
      roster,
      channelId: "CREGI",
    });

    expect(result.kind).toBe("command_add");
    expect(result.task?.number).toBe(4);
    expect(result.text).toContain("task #4");
    expect(mockAddProjectTask).toHaveBeenCalledWith(
      expect.objectContaining({
        project: "regi",
        title: "Call the vendor",
        source: "slack",
        createdByUserId: "u-mo",
        assigneeUserId: "u-mo",
      }),
    );
  });

  it("marks the caller's remaining task done by board number", async () => {
    mockListProjectTasks.mockResolvedValue([
      task({ id: "t2", number: 2, title: "Mo polish", assigneeUserId: "u-mo" }),
    ]);
    mockCompleteProjectTask.mockResolvedValue(
      task({ id: "t2", number: 2, title: "Mo polish", assigneeUserId: "u-mo" }),
    );

    const { parsePiperCommand, processPiperCommand } = await import(
      "@/lib/slack/command"
    );
    const result = await processPiperCommand({
      parsed: parsePiperCommand("done 2"),
      roster,
    });

    expect(result.kind).toBe("command_done");
    expect(result.text).toContain("task #2");
    expect(mockCompleteProjectTask).toHaveBeenCalledWith({
      project: "regi",
      number: 2,
    });
  });

  it("refuses to complete a teammate's task", async () => {
    mockListProjectTasks.mockResolvedValue([
      task({ id: "t1", number: 1, title: "Gabe review", assigneeUserId: "u-gabe" }),
    ]);

    const { parsePiperCommand, processPiperCommand } = await import(
      "@/lib/slack/command"
    );
    const result = await processPiperCommand({
      parsed: parsePiperCommand("done 1"),
      roster,
    });

    expect(result.kind).toBe("command_help");
    expect(result.text).toMatch(/isn’t assigned to you/i);
    expect(mockCompleteProjectTask).not.toHaveBeenCalled();
  });

  it("does not create a task for a list command", async () => {
    mockListProjectTasks.mockResolvedValue([]);

    const { parsePiperCommand, processPiperCommand } = await import(
      "@/lib/slack/command"
    );
    const result = await processPiperCommand({
      parsed: parsePiperCommand("list"),
      roster,
    });

    expect(result.kind).toBe("command_list");
    expect(result.task).toBeUndefined();
    expect(mockAddProjectTask).not.toHaveBeenCalled();
    expect(mockCompleteProjectTask).not.toHaveBeenCalled();
  });
});
