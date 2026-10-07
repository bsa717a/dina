import { describe, expect, it } from "vitest";
import {
  RECENTLY_COMPLETED_MS,
  recentlyCompletedSince,
} from "@/lib/project-tasks/completed-window";

describe("recently completed window", () => {
  it("is two weeks before now", () => {
    const now = new Date("2026-10-07T20:00:00.000Z");
    expect(RECENTLY_COMPLETED_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(recentlyCompletedSince(now).toISOString()).toBe("2026-09-23T20:00:00.000Z");
  });
});
