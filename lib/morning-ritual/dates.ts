import { getDefaultTimeZone } from "@/lib/env";

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** YYYY-MM-DD in America/Denver (or DEFAULT_TIMEZONE). */
export function denverDateString(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getDefaultTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function denverWeekdayLong(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getDefaultTimeZone(),
    weekday: "long",
  }).format(at);
}

/** Long label like "Saturday, August 8, 2026". */
export function denverLongDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getDefaultTimeZone(),
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(at);
}

/** Month name + day for search queries, e.g. "August 8 2026". */
export function denverSearchDateAnchor(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getDefaultTimeZone(),
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(at);
}

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${ymd}`);
  return { y, m, d };
}

export function ymdCompare(a: string, b: string): number {
  return a.localeCompare(b);
}

export function ymdInRange(date: string, start: string, end: string): boolean {
  return ymdCompare(date, start) >= 0 && ymdCompare(date, end) <= 0;
}

/** Monday of the week containing `ymd` (ISO week Mon–Sun), as YYYY-MM-DD. */
export function mondayOfWeekContaining(ymd: string): string {
  const { y, m, d } = parseYmd(ymd);
  // Use UTC noon to avoid DST edge cases when shifting days.
  const utc = Date.UTC(y, m - 1, d, 12, 0, 0);
  const dow = new Date(utc).getUTCDay(); // 0=Sun … 6=Sat
  const back = dow === 0 ? 6 : dow - 1;
  const mon = new Date(utc - back * 86_400_000);
  return [
    mon.getUTCFullYear(),
    String(mon.getUTCMonth() + 1).padStart(2, "0"),
    String(mon.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/** Day index Mon=1 … Sun=7 for a YYYY-MM-DD. */
export function dayIndexMon1(ymd: string): number {
  const { y, m, d } = parseYmd(ymd);
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function formatYmd(y: number, m: number, d: number): string {
  return [
    String(y),
    String(m).padStart(2, "0"),
    String(d).padStart(2, "0"),
  ].join("-");
}

/**
 * Parse CFM range strings like:
 * - "Aug 3–9, 2026"
 * - "Dec 29, 2025 – Jan 4, 2026"
 * - "Jan 26 – Feb 1, 2026"
 * - "Sep 28 – Oct 4, 2026"
 */
export function parseCfmDateRange(range: string): { start: string; end: string } {
  const normalized = range
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  // "Dec 29, 2025 - Jan 4, 2026"
  const crossYear = normalized.match(
    /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (crossYear) {
    const [, m1, d1, y1, m2, d2, y2] = crossYear;
    return {
      start: formatYmd(Number(y1), monthNum(m1), Number(d1)),
      end: formatYmd(Number(y2), monthNum(m2), Number(d2)),
    };
  }

  // "Jan 26 - Feb 1, 2026" / "Sep 28 - Oct 4, 2026"
  const crossMonth = normalized.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (crossMonth) {
    const [, m1, d1, m2, d2, y] = crossMonth;
    return {
      start: formatYmd(Number(y), monthNum(m1), Number(d1)),
      end: formatYmd(Number(y), monthNum(m2), Number(d2)),
    };
  }

  // "Aug 3-9, 2026"
  const sameMonth = normalized.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),?\s+(\d{4})$/,
  );
  if (sameMonth) {
    const [, m, d1, d2, y] = sameMonth;
    return {
      start: formatYmd(Number(y), monthNum(m), Number(d1)),
      end: formatYmd(Number(y), monthNum(m), Number(d2)),
    };
  }

  throw new Error(`Unrecognized CFM date range: ${range}`);
}

/** Parse BoM date like "Mon, Aug 03, 2026". */
export function parseBomDate(label: string): string {
  const m = label
    .trim()
    .match(/^[A-Za-z]{3},\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) throw new Error(`Unrecognized BoM date: ${label}`);
  const [, month, day, year] = m;
  return formatYmd(Number(year), monthNum(month), Number(day));
}

function monthNum(name: string): number {
  const n = MONTHS[name.toLowerCase()];
  if (!n) throw new Error(`Unknown month: ${name}`);
  return n;
}
