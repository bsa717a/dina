import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  normalizePhoneNumber,
  isValidE164,
} from "@/lib/telnyx/roster";

describe("normalizePhoneNumber", () => {
  it("normalizes 10-digit US numbers to E.164", () => {
    expect(normalizePhoneNumber("4352382071")).toBe("+14352382071");
    expect(normalizePhoneNumber("(435) 238-2071")).toBe("+14352382071");
    expect(normalizePhoneNumber("435-238-2071")).toBe("+14352382071");
    expect(normalizePhoneNumber("435.238.2071")).toBe("+14352382071");
  });

  it("normalizes 11-digit US numbers with leading 1", () => {
    expect(normalizePhoneNumber("14352382071")).toBe("+14352382071");
    expect(normalizePhoneNumber("1-435-238-2071")).toBe("+14352382071");
  });

  it("preserves already-normalized E.164 numbers", () => {
    expect(normalizePhoneNumber("+14352382071")).toBe("+14352382071");
    expect(normalizePhoneNumber("+447911123456")).toBe("+447911123456");
  });

  it("handles international numbers", () => {
    expect(normalizePhoneNumber("+447911123456")).toBe("+447911123456");
    expect(normalizePhoneNumber("447911123456")).toBe("+447911123456");
  });

  it("trims whitespace", () => {
    expect(normalizePhoneNumber("  +14352382071  ")).toBe("+14352382071");
  });
});

describe("isValidE164", () => {
  it("accepts valid E.164 numbers", () => {
    expect(isValidE164("+14352382071")).toBe(true);
    expect(isValidE164("+447911123456")).toBe(true);
    expect(isValidE164("+12")).toBe(true);
  });

  it("rejects invalid formats", () => {
    expect(isValidE164("4352382071")).toBe(false);
    expect(isValidE164("+0123456789")).toBe(false);
    expect(isValidE164("14352382071")).toBe(false);
    expect(isValidE164("")).toBe(false);
    expect(isValidE164("not-a-number")).toBe(false);
  });
});

const mockUserFindUnique = vi.fn();
const mockListMemberProjectKeys = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockUserFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/project-tasks/membership", () => ({
  listMemberProjectKeys: (...args: unknown[]) => mockListMemberProjectKeys(...args),
}));

describe("lookupByPhoneNumber", () => {
  beforeEach(() => {
    mockUserFindUnique.mockReset();
    mockListMemberProjectKeys.mockReset();
  });

  it("returns found: false for unknown numbers", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const { lookupByPhoneNumber } = await import("@/lib/telnyx/roster");
    const result = await lookupByPhoneNumber("+19999999999");

    expect(result.found).toBe(false);
    if (!result.found) {
      expect(result.reason).toBe("unknown_number");
      expect(result.phoneNumber).toBe("+19999999999");
    }
  });

  it("returns user and project keys for known numbers", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      name: "Adam Bangerter",
      username: "adam",
      role: "member",
      assistantName: "Penny",
      assistantPersona: "",
      assistantKey: "penny",
      mustChangePassword: false,
      phoneNumber: "+14352382071",
    });
    mockListMemberProjectKeys.mockResolvedValue(["4studentlives", "regi"]);

    const { lookupByPhoneNumber } = await import("@/lib/telnyx/roster");
    const result = await lookupByPhoneNumber("+14352382071");

    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.user.id).toBe("user-1");
      expect(result.user.name).toBe("Adam Bangerter");
      expect(result.user.phoneNumber).toBe("+14352382071");
      expect(result.projectKeys).toEqual(["4studentlives", "regi"]);
    }
  });

  it("normalizes phone numbers before lookup", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const { lookupByPhoneNumber } = await import("@/lib/telnyx/roster");
    await lookupByPhoneNumber("(435) 238-2071");

    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { phoneNumber: "+14352382071" },
    });
  });
});
