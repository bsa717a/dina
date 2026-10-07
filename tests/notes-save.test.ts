import { describe, expect, it } from "vitest";
import {
  createNotesWriteGuard,
  shouldApplyServerNotes,
} from "@/lib/client/notes-save";

describe("notes autosave", () => {
  it("drops an older note response that finishes after a newer one", () => {
    const guard = createNotesWriteGuard();
    const first = guard.start("t1");
    const second = guard.start("t1");

    expect(guard.isCurrent("t1", first)).toBe(false);
    expect(shouldApplyServerNotes(guard, "t1", first)).toBe(false);
    expect(guard.pending("t1")).toBe(true);
    expect(shouldApplyServerNotes(guard, "t1", second)).toBe(true);
    expect(guard.pending("t1")).toBe(false);
  });

  it("keeps local notes when an owner or due-date save returns during a note save", () => {
    const guard = createNotesWriteGuard();
    guard.start("t1");

    expect(shouldApplyServerNotes(guard, "t1", undefined)).toBe(false);
  });

  it("accepts server notes from a non-note save once note saves have settled", () => {
    const guard = createNotesWriteGuard();
    const revision = guard.start("t1");
    expect(shouldApplyServerNotes(guard, "t1", revision)).toBe(true);
    expect(shouldApplyServerNotes(guard, "t1", undefined)).toBe(true);
  });
});