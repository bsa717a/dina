import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  requireSession: vi.fn(async () => ({
    id: "user-derek",
    name: "Derek",
    username: "derek",
    role: "owner",
    assistantName: "Dina",
    assistantPersona: "",
    assistantKey: "dina",
    mustChangePassword: false,
  })),
}));

vi.mock("@/lib/db/client", () => ({
  checkDatabase: vi.fn(async () => ({ ok: true })),
}));

const listStarredMessageRecords = vi.fn(async () => [
  {
    id: "s1",
    role: "assistant",
    conversationId: "c1",
    createdAt: new Date("2026-08-18T18:00:00.000Z"),
    starredAt: new Date("2026-08-18T18:00:00.000Z"),
    content: "Keep this lesson list.",
  },
]);

vi.mock("@/lib/stars/store", () => ({
  STAR_SOFT_CAP: 20,
  listStarredMessageRecords,
}));

describe("GET /api/stars", () => {
  beforeEach(() => {
    listStarredMessageRecords.mockClear();
  });

  it("returns starred messages without a model", async () => {
    const { GET } = await import("@/app/api/stars/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.markdown).toContain("Keep this lesson list.");
    expect(listStarredMessageRecords).toHaveBeenCalled();
  });
});
