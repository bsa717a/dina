import { describe, expect, it } from "vitest";
import {
  dayIndexMon1,
  mondayOfWeekContaining,
  parseCfmDateRange,
  parseBomDate,
} from "@/lib/morning-ritual/dates";
import {
  findBomReadingForDate,
  findCfmLessonForDate,
  loadBomSchedule,
  loadCfmSchedule,
} from "@/lib/morning-ritual/schedules";

describe("morning ritual schedule parsers", () => {
  it("parses CFM date ranges including cross-month and cross-year", () => {
    expect(parseCfmDateRange("Aug 3–9, 2026")).toEqual({
      start: "2026-08-03",
      end: "2026-08-09",
    });
    expect(parseCfmDateRange("Jan 26 – Feb 1, 2026")).toEqual({
      start: "2026-01-26",
      end: "2026-02-01",
    });
    expect(parseCfmDateRange("Dec 29, 2025 – Jan 4, 2026")).toEqual({
      start: "2025-12-29",
      end: "2026-01-04",
    });
    expect(parseCfmDateRange("Sep 28 – Oct 4, 2026")).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
    });
  });

  it("parses BoM date labels", () => {
    expect(parseBomDate("Mon, Aug 03, 2026")).toBe("2026-08-03");
    expect(parseBomDate("Sat, Aug 08, 2026")).toBe("2026-08-08");
  });

  it("resolves CFM lesson 32 for Aug 3–9 2026", () => {
    const lesson = findCfmLessonForDate("2026-08-03");
    expect(lesson?.lessonNumber).toBe("32");
    expect(lesson?.scriptureBlock).toMatch(/Esther/i);
    expect(lesson?.url).toContain("/32?");
    expect(findCfmLessonForDate("2026-08-09")?.lessonNumber).toBe("32");
    expect(findCfmLessonForDate("2026-08-10")?.lessonNumber).toBe("33");
  });

  it("resolves BoM Day 100 Alma 7 on Aug 3 2026", () => {
    const row = findBomReadingForDate("2026-08-03");
    expect(row?.day).toBe(100);
    expect(row?.reading).toBe("Alma 7");
    expect(row?.totalDays).toBe(229);
  });

  it("loads full year schedules", () => {
    expect(loadCfmSchedule().length).toBe(52);
    expect(loadBomSchedule().readings.length).toBe(229);
  });

  it("uses Mon–Sun day index (Mon=1)", () => {
    expect(mondayOfWeekContaining("2026-08-08")).toBe("2026-08-03");
    expect(dayIndexMon1("2026-08-03")).toBe(1);
    expect(dayIndexMon1("2026-08-08")).toBe(6);
    expect(dayIndexMon1("2026-08-09")).toBe(7);
  });
});
