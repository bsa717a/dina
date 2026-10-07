import { describe, expect, it } from "vitest";
import {
  RCS_CARD_DESCRIPTION_MAX,
  RCS_CARD_SUGGESTIONS_MAX,
  RCS_CARD_TITLE_MAX,
  RCS_CAROUSEL_MAX,
  RCS_CAROUSEL_MIN,
  RCS_POSTBACK_MAX,
  RCS_SUGGESTION_TEXT_MAX,
  buildTaskRcsCard,
  cardsInTaskRcsPart,
  classifyInboundTask,
  formatOpenTaskSms,
  formatTaskDoneReply,
  isOpenTaskListAsk,
  parseDoneCommand,
  planTaskRcsParts,
  taskBelongsToUser,
  taskCardTitle,
  taskDueLabel,
  taskIdFromPostback,
  taskOwnerLabel,
  taskRcsPartToContent,
} from "@/lib/telnyx/task-cards";

const viewer = { id: "user-derek", name: "Derek Fowler", username: "derek" };

function card(id: string, title = `Task ${id}`) {
  return buildTaskRcsCard({
    id,
    title,
    owner: "Derek",
    due: "10/9/2026",
  });
}

describe("task card limits", () => {
  it("puts title, owner, and due on the card with one Done reply", () => {
    const built = buildTaskRcsCard({
      id: "task-1",
      title: "Survey Lost Deals (owner: Adam, due 10/9/2026)",
      owner: "Adam",
      due: "10/9/2026",
    });

    expect(built.title).toBe("Survey Lost Deals");
    expect(built.title.length).toBeLessThanOrEqual(RCS_CARD_TITLE_MAX);
    expect(built.description).toBe("Owner: Adam\nDue: 10/9/2026");
    expect(built.description!.length).toBeLessThanOrEqual(RCS_CARD_DESCRIPTION_MAX);
    expect(built.suggestions).toHaveLength(1);
    expect(built.suggestions!.length).toBeLessThanOrEqual(RCS_CARD_SUGGESTIONS_MAX);
    expect(built.suggestions![0]?.reply.text).toBe("Done");
    expect(built.suggestions![0]?.reply.text.length).toBeLessThanOrEqual(
      RCS_SUGGESTION_TEXT_MAX,
    );
    expect(built.suggestions![0]?.reply.postback_data).toBe(
      "piper-task-done:task-1",
    );
    expect(built.suggestions![0]?.reply.postback_data.length).toBeLessThanOrEqual(
      RCS_POSTBACK_MAX,
    );
    expect(built.suggestions![0]).not.toHaveProperty("action");
  });

  it("truncates a long title to 200 characters", () => {
    const built = buildTaskRcsCard({
      id: "task-long",
      title: "A".repeat(250),
      owner: "B".repeat(3000),
      due: "10/9/2026",
    });
    expect(built.title.length).toBe(RCS_CARD_TITLE_MAX);
    expect(built.title.endsWith("…")).toBe(true);
    expect(built.description!.length).toBeLessThanOrEqual(RCS_CARD_DESCRIPTION_MAX);
  });

  it("sends one standalone card, carousels of 2–10, and another message after 10", () => {
    const one = planTaskRcsParts([card("1")]);
    expect(one).toEqual([{ kind: "standalone", card: card("1") }]);

    const two = planTaskRcsParts([card("1"), card("2")]);
    expect(two[0]?.kind).toBe("carousel");
    if (two[0]?.kind === "carousel") {
      expect(two[0].cards.length).toBeGreaterThanOrEqual(RCS_CAROUSEL_MIN);
      expect(two[0].cards.length).toBeLessThanOrEqual(RCS_CAROUSEL_MAX);
    }

    const eleven = planTaskRcsParts(
      Array.from({ length: 11 }, (_, index) => card(String(index + 1))),
    );
    expect(eleven).toHaveLength(2);
    expect(eleven[0]?.kind).toBe("carousel");
    expect(eleven[1]?.kind).toBe("standalone");
    if (eleven[0]?.kind === "carousel") {
      expect(eleven[0].cards).toHaveLength(RCS_CAROUSEL_MAX);
    }
    expect(cardsInTaskRcsPart(eleven[0]!) + cardsInTaskRcsPart(eleven[1]!)).toBe(11);

    const twelve = planTaskRcsParts(
      Array.from({ length: 12 }, (_, index) => card(String(index + 1))),
    );
    expect(twelve.map((part) => cardsInTaskRcsPart(part))).toEqual([10, 2]);
    expect(twelve.every((part) => part.kind === "carousel")).toBe(true);

    const content = taskRcsPartToContent(eleven[0]!);
    expect("rich_card" in content).toBe(true);
  });
});

describe("SMS fallback list", () => {
  it("numbers tasks and tells the user to reply done N", () => {
    expect(
      formatOpenTaskSms([
        { title: "Survey Lost Deals", owner: "Adam", due: "10/9/2026" },
        { title: "Call Breck", owner: "Derek", due: null },
      ]),
    ).toBe(
      [
        "Open tasks:",
        "1. Survey Lost Deals — Adam — due 10/9/2026",
        "2. Call Breck — Derek — no due date",
        "Reply done N to complete task N.",
      ].join("\n"),
    );
  });

  it("keeps original numbers on a remainder list", () => {
    const text = formatOpenTaskSms(
      [{ title: "Eleventh", owner: "Derek", due: null }],
      11,
    );
    expect(text).toContain("Open tasks continued:");
    expect(text).toContain("11. Eleventh — Derek — no due date");
  });
});

describe("done commands and ownership", () => {
  it("parses done N and ignores other text", () => {
    expect(parseDoneCommand("done 2")).toBe(2);
    expect(parseDoneCommand("DONE #3")).toBe(3);
    expect(parseDoneCommand("done 0")).toBeNull();
    expect(parseDoneCommand("done the first one")).toBeNull();
    expect(isOpenTaskListAsk("my tasks")).toBe(true);
    expect(isOpenTaskListAsk("show me my open tasks")).toBe(true);
    expect(isOpenTaskListAsk("what are my tasks")).toBe(true);
    expect(isOpenTaskListAsk("What is on the 4SL backlog?")).toBe(false);
    expect(isOpenTaskListAsk("done 1")).toBe(false);
    expect(classifyInboundTask("Done", "piper-task-done:task-1")).toEqual({
      kind: "done-id",
      taskId: "task-1",
    });
    expect(classifyInboundTask("done 4", null)).toEqual({
      kind: "done-number",
      number: 4,
    });
    expect(taskIdFromPostback("not-ours")).toBeNull();
  });

  it("matches assignee id, otherwise owner: in the title", () => {
    expect(
      taskBelongsToUser(
        { title: "Call Breck", assigneeUserId: "user-derek" },
        viewer,
      ),
    ).toBe(true);
    expect(
      taskBelongsToUser(
        { title: "Call Breck", assigneeUserId: "someone-else" },
        viewer,
      ),
    ).toBe(false);
    expect(
      taskBelongsToUser(
        {
          title: "Survey Lost Deals (owner: Derek, due 10/9/2026)",
          assigneeUserId: null,
        },
        viewer,
      ),
    ).toBe(true);
    expect(
      taskBelongsToUser(
        { title: "Survey Lost Deals (owner: Adam)", assigneeUserId: null },
        viewer,
      ),
    ).toBe(false);
    expect(taskOwnerLabel("Survey (owner: Adam, due 10/9/2026)")).toBe("Adam");
    expect(taskDueLabel("Survey (owner: Adam, due 10/9/2026)")).toBe("10/9/2026");
    expect(taskCardTitle("Survey (owner: Adam, due 10/9/2026)")).toBe("Survey");
  });

  it("confirms completion with a check mark and the task title", () => {
    expect(formatTaskDoneReply("Survey Lost Deals (owner: Adam)", false)).toBe(
      "✅ Survey Lost Deals",
    );
    expect(formatTaskDoneReply("Survey Lost Deals", true)).toBe(
      "✅ Survey Lost Deals is already done.",
    );
  });
});
