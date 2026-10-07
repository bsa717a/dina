import { describe, expect, it } from "vitest";
import {
  dueLabelToIso,
  formatDueOn,
  isoToDueLabel,
  parseDueOn,
  parseWhiteboardScope,
  rewriteTaskTitle,
  taskDueLabel,
  taskOwnedByViewer,
  taskOwnerLabel,
  whiteboardHeading,
  whiteboardOwnerName,
  whiteboardScopeStorageKey,
} from "@/lib/client/whiteboard";

describe("whiteboard heading", () => {
  it("uses the display name when Piper has one", () => {
    expect(whiteboardOwnerName({ name: "Adam", username: "adam_bangerter" })).toBe(
      "Adam",
    );
    expect(whiteboardHeading("Adam")).toBe("Adam's Whiteboard");
  });

  it("falls back to the username when the display name is blank", () => {
    expect(whiteboardOwnerName({ name: "  ", username: "adam" })).toBe("adam");
    expect(whiteboardHeading("adam")).toBe("adam's Whiteboard");
  });

  it("stays generic until a name is known", () => {
    expect(whiteboardOwnerName(null)).toBe("");
    expect(whiteboardHeading("")).toBe("Whiteboard");
  });
});

describe("whiteboard mine filter", () => {
  const derek = { id: "user-derek", name: "Derek", username: "derek" };

  it("reads owner text from the task title", () => {
    expect(taskOwnerLabel("Survey Lost Deals (owner: Adam, due 10/9/2026)")).toBe(
      "Adam",
    );
    expect(taskOwnerLabel("Call the district (owner: Derek, due 10/12/2026)")).toBe(
      "Derek",
    );
    expect(taskOwnerLabel("Review the proposal")).toBeNull();
  });

  it("matches the signed-in display name or username", () => {
    expect(
      taskOwnedByViewer(
        { title: "Call the district (owner: Derek, due 10/12/2026)", assigneeUserId: null },
        derek,
      ),
    ).toBe(true);
    expect(
      taskOwnedByViewer(
        { title: "Survey Lost Deals (owner: Adam, due 10/9/2026)", assigneeUserId: null },
        derek,
      ),
    ).toBe(false);
    expect(
      taskOwnedByViewer(
        { title: "Send the recap (owner: derek)", assigneeUserId: null },
        { id: "u", name: "  ", username: "derek" },
      ),
    ).toBe(true);
  });

  it("matches a first name in the title to a longer display name or username", () => {
    expect(
      taskOwnedByViewer(
        { title: "Survey Lost Deals (owner: Adam, due 10/9/2026)", assigneeUserId: null },
        { id: "u-adam", name: "Adam Bangerter", username: "adam_bangerter" },
      ),
    ).toBe(true);
    expect(
      taskOwnedByViewer(
        { title: "Survey Lost Deals (owner: Adam, due 10/9/2026)", assigneeUserId: null },
        { id: "u-adam", name: "", username: "adam_bangerter" },
      ),
    ).toBe(true);
  });

  it("uses the assignee when that field is set", () => {
    expect(
      taskOwnedByViewer(
        { title: "Review the proposal", assigneeUserId: "user-derek" },
        derek,
      ),
    ).toBe(true);
    expect(
      taskOwnedByViewer(
        { title: "Review the proposal (owner: Derek)", assigneeUserId: "user-adam" },
        derek,
      ),
    ).toBe(false);
    expect(
      taskOwnedByViewer({ title: "Review the proposal", assigneeUserId: null }, derek),
    ).toBe(false);
  });

  it("remembers all or mine per user", () => {
    expect(parseWhiteboardScope("mine")).toBe("mine");
    expect(parseWhiteboardScope("all")).toBe("all");
    expect(parseWhiteboardScope(null)).toBe("all");
    expect(whiteboardScopeStorageKey("user-derek")).toBe(
      "dina.whiteboardScope.user-derek",
    );
  });
});

describe("task due date and title", () => {
  it("reads a due date from the title", () => {
    expect(taskDueLabel("Survey (owner: Adam, due 10/9/2026)")).toBe("10/9/2026");
    expect(taskDueLabel("Review the proposal")).toBeNull();
  });

  it("turns calendar labels into a date input value", () => {
    expect(dueLabelToIso("10/9/2026")).toBe("2026-10-09");
    expect(dueLabelToIso("2026-10-09")).toBe("2026-10-09");
    expect(dueLabelToIso("Oct 9, 2026")).toBe("2026-10-09");
    expect(dueLabelToIso("2026-02-31")).toBeNull();
    expect(isoToDueLabel("2026-10-09")).toBe("10/9/2026");
    expect(formatDueOn(new Date("2026-10-09T00:00:00.000Z"))).toBe("2026-10-09");
    expect(parseDueOn("2026-10-09")?.toISOString()).toBe("2026-10-09T00:00:00.000Z");
    expect(parseDueOn(null)).toBeNull();
  });

  it("rewrites only the owner or due parenthetical", () => {
    const title = "Call the district (owner: Derek, due 10/12/2026)";
    expect(rewriteTaskTitle(title, { owner: "Adam" })).toBe(
      "Call the district (owner: Adam, due 10/12/2026)",
    );
    expect(rewriteTaskTitle(title, { due: "10/9/2026" })).toBe(
      "Call the district (owner: Derek, due 10/9/2026)",
    );
    expect(rewriteTaskTitle(title, { owner: null, due: null })).toBe("Call the district");
    expect(rewriteTaskTitle("Review the proposal", { due: "10/12/2026" })).toBe(
      "Review the proposal (due 10/12/2026)",
    );
  });
});
