import { describe, expect, it } from "vitest";
import {
  parseWhiteboardScope,
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
