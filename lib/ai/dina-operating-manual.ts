import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Foundational Dina operating manual (decision framework, authority, briefing). */
export function getDinaOperatingManual(): string {
  if (cached) return cached;
  cached = readFileSync(
    join(process.cwd(), "dina-operating-manual.md"),
    "utf8",
  );
  return cached;
}
