import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Foundational operating document — not silently rewritten by memory. */
export function getConstitution(): string {
  if (cached) return cached;
  cached = readFileSync(join(process.cwd(), "constitution.md"), "utf8");
  return cached;
}
