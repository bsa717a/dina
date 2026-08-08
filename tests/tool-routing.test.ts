import { describe, expect, it } from "vitest";
import {
  friendlyToolStatus,
  isSharePointListQuestion,
  isWordDocumentRequest,
  looksLikeStallingFiller,
} from "@/lib/ai/tool-routing";

describe("tool routing helpers", () => {
  it("treats please-hold narration as stalling filler", () => {
    expect(
      looksLikeStallingFiller(
        "I will assemble and format these now.\n\nPlease hold for a moment while I prepare the complete document.",
      ),
    ).toBe(true);
    expect(looksLikeStallingFiller("Document updated on OneDrive.")).toBe(false);
  });

  it("does not treat generic list requests as SharePoint lists", () => {
    expect(isSharePointListQuestion("remember that list for later")).toBe(false);
    expect(isSharePointListQuestion("expand the blessings list")).toBe(false);
    expect(isSharePointListQuestion("SharePoint list Network Info")).toBe(true);
    expect(isSharePointListQuestion("pull from Network Info")).toBe(true);
  });

  it("detects Word document requests", () => {
    expect(isWordDocumentRequest("put this in a word document on OneDrive")).toBe(
      true,
    );
    expect(isWordDocumentRequest("update EQ Temple Lesson.docx")).toBe(true);
    expect(isWordDocumentRequest("what's on my calendar today")).toBe(false);
  });

  it("maps tool names to friendly status labels", () => {
    expect(friendlyToolStatus("create_word_document")).toMatch(/Word/i);
    expect(friendlyToolStatus("search_memory")).toMatch(/memory/i);
  });
});
