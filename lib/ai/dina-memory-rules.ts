import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Foundational Dina memory operating rules. */
export function getDinaMemoryRules(): string {
  if (cached) return cached;
  cached = readFileSync(join(process.cwd(), "dina-memory-rules.md"), "utf8");
  return cached;
}
