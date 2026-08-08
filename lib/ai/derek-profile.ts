import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Foundational Derek profile document. */
export function getDerekProfile(): string {
  if (cached) return cached;
  cached = readFileSync(join(process.cwd(), "derek-fowler-profile.md"), "utf8");
  return cached;
}
