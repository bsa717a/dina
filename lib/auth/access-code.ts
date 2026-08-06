import { timingSafeEqual } from "crypto";

export function verifyAccessCode(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Compare against itself to keep timing roughly constant on length mismatch
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
