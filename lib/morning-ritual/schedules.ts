import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBomDate, parseCfmDateRange, ymdInRange } from "@/lib/morning-ritual/dates";
import type { BomReading, CfmLesson } from "@/lib/morning-ritual/types";

const CFM_PATH = join(process.cwd(), "content/schedules/cfm_schedule_2026.md");
const BOM_PATH = join(process.cwd(), "content/schedules/bom_schedule_2026.md");

let cfmCache: CfmLesson[] | null = null;
let bomCache: BomReading[] | null = null;
let bomTotalDays = 229;

function markdownLink(cell: string): { text: string; url: string } {
  const m = cell.trim().match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (m) return { text: m[1], url: m[2] };
  return { text: cell.trim(), url: "" };
}

export function loadCfmSchedule(markdown?: string): CfmLesson[] {
  if (!markdown && cfmCache) return cfmCache;
  const text = markdown ?? readFileSync(CFM_PATH, "utf8");
  const lessons: CfmLesson[] = [];
  for (const line of text.split("\n")) {
    if (!/^\|\s*\d{2}\s*\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const [lessonNumber, dates, scriptureBlock, linkCell] = cells;
    if (!/^\d{2}$/.test(lessonNumber)) continue;
    const { start, end } = parseCfmDateRange(dates);
    const { url } = markdownLink(linkCell);
    lessons.push({
      lessonNumber,
      lessonKey: `ot-2026-${lessonNumber}`,
      start,
      end,
      scriptureBlock,
      url,
    });
  }
  if (!markdown) cfmCache = lessons;
  return lessons;
}

export function loadBomSchedule(markdown?: string): {
  readings: BomReading[];
  totalDays: number;
} {
  if (!markdown && bomCache) {
    return { readings: bomCache, totalDays: bomTotalDays };
  }
  const text = markdown ?? readFileSync(BOM_PATH, "utf8");
  const totalMatch = text.match(/\*\*Total reading days:\*\*\s*(\d+)/i);
  const totalDays = totalMatch ? Number(totalMatch[1]) : 229;
  const readings: BomReading[] = [];
  for (const line of text.split("\n")) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const [dayStr, dateLabel, reading, linkCell] = cells;
    if (!/^\d+$/.test(dayStr)) continue;
    const { url } = markdownLink(linkCell);
    readings.push({
      day: Number(dayStr),
      totalDays,
      date: parseBomDate(dateLabel),
      reading,
      url,
    });
  }
  if (!markdown) {
    bomCache = readings;
    bomTotalDays = totalDays;
  }
  return { readings, totalDays };
}

export function findCfmLessonForDate(ymd: string, markdown?: string): CfmLesson | null {
  const lessons = loadCfmSchedule(markdown);
  return lessons.find((l) => ymdInRange(ymd, l.start, l.end)) ?? null;
}

export function findBomReadingForDate(
  ymd: string,
  markdown?: string,
): BomReading | null {
  const { readings } = loadBomSchedule(markdown);
  return readings.find((r) => r.date === ymd) ?? null;
}

/** Reset caches (tests). */
export function resetScheduleCaches() {
  cfmCache = null;
  bomCache = null;
  bomTotalDays = 229;
}
