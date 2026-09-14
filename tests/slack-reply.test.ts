import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SlackLedgerResult } from "@/lib/slack/ledger";
import type { SlackRosterLookupResult } from "@/lib/slack/types";

const mockListProjectTasks = vi.fn();

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: (...args: unknown[]) => mockListProjectTasks(...args),
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
  user: { id: "u1", name: "Alex", username: "alex", slackUserId: "U012ALEX" },
  projectKeys: ["regi"],
  onRegiProject: true,
};

const createdLedger: SlackLedgerResult = {
  task: { id: "t-query", number: 3, title: "show remaining tasks", created: true },
  attention: { id: "a1" },
};

const updatedLedger: SlackLedgerResult = {
  task: { id: "t-work", number: 1, title: "ship the dashboard polish", created: false },
  attention: { id: "a1" },
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

describe("classifySlackLocalIntent", () => {
  it("treats remaining-task asks as remaining_tasks", async () => {
    const { classifySlackLocalIntent } = await import("@/lib/slack/reply");
    expect(classifySlackLocalIntent("show remaining tasks")).toBe("remaining_tasks");
    expect(classifySlackLocalIntent("Show remaining tasks!")).toBe("remaining_tasks");
    expect(classifySlackLocalIntent("list remaining tasks")).toBe("remaining_tasks");
    expect(classifySlackLocalIntent("what's remaining")).toBe("remaining_tasks");
    expect(classifySlackLocalIntent("task list")).toBe("remaining_tasks");
    expect(classifySlackLocalIntent("what's left")).toBe("remaining_tasks");
  });

  it("treats assignee status asks as assignee_status", async () => {
    const { classifySlackLocalIntent } = await import("@/lib/slack/reply");
    expect(classifySlackLocalIntent("my remaining tasks")).toBe("assignee_status");
    expect(classifySlackLocalIntent("my tasks")).toBe("assignee_status");
    expect(classifySlackLocalIntent("assigned to me")).toBe("assignee_status");
    expect(classifySlackLocalIntent("what's on my plate")).toBe("assignee_status");
    expect(classifySlackLocalIntent("status")).toBe("assignee_status");
    expect(classifySlackLocalIntent("what's my status")).toBe("assignee_status");
  });

  it("leaves work requests on the ack path", async () => {
    const { classifySlackLocalIntent } = await import("@/lib/slack/reply");
    expect(classifySlackLocalIntent("ship the dashboard polish")).toBe("ack");
    expect(classifySlackLocalIntent("add remaining tasks to the board")).toBe("ack");
    expect(classifySlackLocalIntent("we still have remaining tasks to ship")).toBe(
      "ack",
    );
  });
});

describe("buildSlackLocalReply", () => {
  beforeEach(() => {
    vi.resetModules();
    mockListProjectTasks.mockReset();
  });

  it("recites remaining Regi tasks without a model", async () => {
    mockListProjectTasks.mockResolvedValue([
      task({ id: "t1", number: 1, title: "Polish the dashboard" }),
      task({ id: "t-query", number: 2, title: "show remaining tasks" }),
    ]);

    const { buildSlackLocalReply } = await import("@/lib/slack/reply");
    const result = await buildSlackLocalReply({
      text: "show remaining tasks",
      roster,
      ledger: createdLedger,
    });

    expect(result.kind).toBe("remaining_tasks");
    expect(result.text).toContain("Remaining tasks for Regi:");
    expect(result.text).toContain("1. Polish the dashboard");
    expect(result.text).not.toContain("show remaining tasks");
    expect(mockListProjectTasks).toHaveBeenCalledWith({ project: "regi" });
  });

  it("lists assignee-scoped remaining tasks", async () => {
    mockListProjectTasks.mockResolvedValue([
      task({
        id: "t1",
        number: 1,
        title: "Alex polish",
        assigneeUserId: "u1",
      }),
      task({
        id: "t2",
        number: 2,
        title: "Pat review",
        assigneeUserId: "u2",
      }),
    ]);

    const { buildSlackLocalReply } = await import("@/lib/slack/reply");
    const result = await buildSlackLocalReply({
      text: "my remaining tasks",
      roster,
      ledger: updatedLedger,
    });

    expect(result.kind).toBe("assignee_status");
    expect(result.text).toContain("Remaining Regi tasks assigned to Alex:");
    expect(result.text).toContain("1. Alex polish");
    expect(result.text).not.toContain("Pat review");
  });

  it("acks work requests from the ledger", async () => {
    const { buildSlackLocalReply } = await import("@/lib/slack/reply");
    const result = await buildSlackLocalReply({
      text: "ship the dashboard polish",
      roster,
      ledger: {
        task: { id: "t1", number: 4, title: "ship the dashboard polish", created: true },
        attention: { id: "a1" },
      },
    });

    expect(result.kind).toBe("ack");
    expect(result.text).toContain("Got it — logged on Regi");
    expect(result.text).toContain("task #4");
    expect(mockListProjectTasks).not.toHaveBeenCalled();
  });

  it("falls back to an ack when the remaining list fails", async () => {
    mockListProjectTasks.mockRejectedValue(new Error("db down"));

    const { buildSlackLocalReply } = await import("@/lib/slack/reply");
    const result = await buildSlackLocalReply({
      text: "show remaining tasks",
      roster,
      ledger: createdLedger,
    });

    expect(result.kind).toBe("ack");
    expect(result.text).toContain("task #3");
  });
});
