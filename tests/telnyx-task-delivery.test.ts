import { beforeEach, describe, expect, it, vi } from "vitest";

const listProjectTasks = vi.fn();
const completeProjectTask = vi.fn();
const getProjectTask = vi.fn();
const findMany = vi.fn();
const sendRcsContent = vi.fn();
const sendReply = vi.fn();

vi.mock("@/lib/project-tasks/store", () => ({
  listProjectTasks: (...args: unknown[]) => listProjectTasks(...args),
  completeProjectTask: (...args: unknown[]) => completeProjectTask(...args),
  getProjectTask: (...args: unknown[]) => getProjectTask(...args),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

vi.mock("@/lib/telnyx/client", () => ({
  sendRcsContent: (...args: unknown[]) => sendRcsContent(...args),
  sendReply: (...args: unknown[]) => sendReply(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const user = { id: "user-derek", name: "Derek Fowler", username: "derek" };

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    projectKey: "4studentlives",
    title: "Survey Lost Deals (owner: Derek, due 10/9/2026)",
    description: "",
    status: "open",
    sortOrder: 1,
    source: "chat",
    createdByUserId: null,
    assigneeUserId: null,
    sectionId: null,
    sectionName: null,
    completedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    number: 1,
    ...overrides,
  };
}

describe("deliverInboundTaskIntent", () => {
  beforeEach(() => {
    vi.resetModules();
    listProjectTasks.mockReset();
    completeProjectTask.mockReset();
    getProjectTask.mockReset();
    findMany.mockReset();
    sendRcsContent.mockReset();
    sendReply.mockReset();
    findMany.mockResolvedValue([]);
    sendRcsContent.mockResolvedValue({
      sent: true,
      type: "RCS",
      messageId: "rcs-1",
    });
    sendReply.mockResolvedValue({ sent: true, type: "SMS", messageId: "sms-1" });
  });

  it("sends one carousel per ten open tasks and a standalone card for the remainder", async () => {
    const tasks = Array.from({ length: 11 }, (_, index) =>
      task({
        id: `task-${index + 1}`,
        title: `Task ${index + 1} (owner: Derek)`,
        number: index + 1,
      }),
    );
    listProjectTasks.mockResolvedValue(tasks);

    const { deliverInboundTaskIntent } = await import("@/lib/telnyx/task-delivery");
    const result = await deliverInboundTaskIntent({
      to: "+19044030781",
      preferRcs: true,
      user,
      projectKeys: ["4studentlives"],
      intent: { kind: "list" },
    });

    expect(result.type).toBe("RCS");
    expect(sendRcsContent).toHaveBeenCalledTimes(2);
    const first = sendRcsContent.mock.calls[0][0];
    const second = sendRcsContent.mock.calls[1][0];
    expect(first.content.rich_card.carousel_card.card_contents).toHaveLength(10);
    expect(first.content.rich_card.carousel_card.card_contents[0].suggestions[0].reply.text).toBe(
      "Done",
    );
    expect(
      first.content.rich_card.carousel_card.card_contents[0].suggestions[0].reply.postback_data,
    ).toBe("piper-task-done:task-1");
    expect(first.smsText).toContain("1. Task 1");
    expect(first.smsText).toContain("Reply done N to complete task N.");
    expect(second.content.rich_card.standalone_card.card_content.title).toBe("Task 11");
    expect(second.smsText).toBeUndefined();
    expect(sendReply).not.toHaveBeenCalled();
  });

  it("sends the numbered SMS list when the inbound channel is SMS", async () => {
    listProjectTasks.mockResolvedValue([task(), task({ id: "task-2", title: "Call Breck (owner: Derek)", number: 2 })]);
    const { deliverInboundTaskIntent } = await import("@/lib/telnyx/task-delivery");
    await deliverInboundTaskIntent({
      to: "+19044030781",
      preferRcs: false,
      user,
      projectKeys: ["4studentlives"],
      intent: { kind: "list" },
    });

    expect(sendRcsContent).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith(
      "+19044030781",
      expect.stringContaining("1. Survey Lost Deals — Derek — due 10/9/2026"),
      false,
      { allowSmsFallback: true },
    );
    const text = sendReply.mock.calls[0][1] as string;
    expect(text).toContain("2. Call Breck — Derek — no due date");
    expect(text).toContain("Reply done N to complete task N.");
  });

  it("completes done N with completeProjectTask and confirms with a check mark", async () => {
    listProjectTasks.mockResolvedValue([
      task(),
      task({ id: "task-2", title: "Call Breck (owner: Derek)", number: 2 }),
    ]);
    getProjectTask.mockResolvedValue(task({ id: "task-2", title: "Call Breck (owner: Derek)" }));
    completeProjectTask.mockResolvedValue({
      ...task({ id: "task-2", title: "Call Breck (owner: Derek)", status: "done" }),
    });

    const { deliverInboundTaskIntent } = await import("@/lib/telnyx/task-delivery");
    await deliverInboundTaskIntent({
      to: "+19044030781",
      preferRcs: false,
      user,
      projectKeys: ["4studentlives"],
      intent: { kind: "done-number", number: 2 },
    });

    expect(completeProjectTask).toHaveBeenCalledWith({ taskId: "task-2" });
    expect(sendReply).toHaveBeenCalledWith(
      "+19044030781",
      "✅ Call Breck",
      false,
      { allowSmsFallback: true },
    );
  });

  it("completes a Done suggestion by task id on the same path", async () => {
    getProjectTask.mockResolvedValue(task());
    completeProjectTask.mockResolvedValue({ ...task(), status: "done" });

    const { deliverInboundTaskIntent } = await import("@/lib/telnyx/task-delivery");
    await deliverInboundTaskIntent({
      to: "+19044030781",
      preferRcs: true,
      user,
      projectKeys: ["4studentlives"],
      intent: { kind: "done-id", taskId: "task-1" },
    });

    expect(completeProjectTask).toHaveBeenCalledWith({ taskId: "task-1" });
    expect(sendReply).toHaveBeenCalledWith(
      "+19044030781",
      "✅ Survey Lost Deals",
      true,
      { allowSmsFallback: true },
    );
  });

  it("marks Survey Lost Deals done from the 7:39 PM Done tap even though Adam owns it", async () => {
    const doneTap = {
      event_type: "message.received",
      payload: {
        body: {
          suggestion_response: {
            postback_data: "piper-task-done:cmux0glpu0047s6012ggb6wyu",
            text: "Done",
          },
        },
        direction: "inbound",
        from: { phone_number: "+19044030781" },
        id: "fd471662-3f58-44ed-8339-f7489e6cff4b",
        type: "RCS",
      },
    };
    const { extractSuggestionPostback, normalizeInboundMessage } = await import(
      "@/lib/telnyx/inbound"
    );
    const normalized = normalizeInboundMessage(doneTap.payload, "2026-10-07T19:39:54Z");
    const postback = extractSuggestionPostback(normalized);
    expect(normalized?.text).toBe("Done");
    expect(postback).toBe("piper-task-done:cmux0glpu0047s6012ggb6wyu");

    const survey = task({
      id: "cmux0glpu0047s6012ggb6wyu",
      projectKey: "4studentlives",
      title: "Survey Lost Deals (owner: Adam, due 10/9/2026)",
      status: "open",
      assigneeUserId: "user-adam",
    });
    getProjectTask.mockResolvedValue(survey);
    completeProjectTask.mockResolvedValue({ ...survey, status: "done" });
    sendReply.mockResolvedValue({ sent: true, type: "RCS", messageId: "done-out" });

    const { maybeDeliverInboundTasks } = await import("@/lib/telnyx/task-delivery");
    await maybeDeliverInboundTasks({
      to: "+19044030781",
      text: normalized?.text ?? "",
      postback,
      preferRcs: true,
      user,
      projectKeys: ["4studentlives"],
    });

    expect(completeProjectTask).toHaveBeenCalledWith({
      taskId: "cmux0glpu0047s6012ggb6wyu",
    });
    expect(sendReply).toHaveBeenCalledWith(
      "+19044030781",
      "✅ Survey Lost Deals",
      true,
      { allowSmsFallback: true },
    );
  });

  it("does not complete a task outside the sender's projects", async () => {
    getProjectTask.mockResolvedValue(task({ projectKey: "other-project" }));

    const { deliverInboundTaskIntent } = await import("@/lib/telnyx/task-delivery");
    await deliverInboundTaskIntent({
      to: "+19044030781",
      preferRcs: true,
      user,
      projectKeys: ["4studentlives"],
      intent: { kind: "done-id", taskId: "task-1" },
    });

    expect(completeProjectTask).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0][1]).toBe("That task isn't on your open list.");
  });
});
