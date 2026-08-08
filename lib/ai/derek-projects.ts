import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Foundational Derek projects document. */
export function getDerekProjects(): string {
  if (cached) return cached;
  cached = readFileSync(join(process.cwd(), "derek-projects.md"), "utf8");
  return cached;
}
