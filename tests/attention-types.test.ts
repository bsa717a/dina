import { describe, expect, it } from "vitest";
import { categoryLabel, isActionableCategory } from "@/lib/attention/types";

describe("attention types", () => {
  it("labels categories for the home screen", () => {
    expect(categoryLabel("reply_required")).toBe("Reply Required");
    expect(categoryLabel("decision_required")).toBe("Decision Required");
    expect(categoryLabel("calendar_action")).toBe("Calendar Action");
    expect(categoryLabel("waiting_on_someone")).toBe("Waiting On Someone Else");
    expect(categoryLabel("fyi_ignore")).toBe("FYI / Ignore");
  });

  it("treats fyi_ignore as non-actionable", () => {
    expect(isActionableCategory("reply_required")).toBe(true);
    expect(isActionableCategory("fyi_ignore")).toBe(false);
  });
});
