import { describe, expect, it } from "vitest";
import {
  hashAccessCode,
  verifyAccessCode,
  verifyHashedAccessCode,
} from "@/lib/auth/access-code";

describe("verifyAccessCode", () => {
  it("accepts the correct code", () => {
    expect(verifyAccessCode("secret-code", "secret-code")).toBe(true);
  });

  it("rejects an incorrect code", () => {
    expect(verifyAccessCode("wrong", "secret-code")).toBe(false);
  });

  it("rejects codes with different lengths", () => {
    expect(verifyAccessCode("short", "much-longer-code")).toBe(false);
  });
});

describe("hashed access codes", () => {
  it("verifies a hashed code and rejects a wrong one", () => {
    const stored = hashAccessCode("team-secret");
    expect(verifyHashedAccessCode("team-secret", stored)).toBe(true);
    expect(verifyHashedAccessCode("nope", stored)).toBe(false);
  });
});
