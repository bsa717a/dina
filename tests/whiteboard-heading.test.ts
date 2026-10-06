import { describe, expect, it } from "vitest";
import {
  whiteboardHeading,
  whiteboardOwnerName,
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
