import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const del = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    pushSubscription: {
      upsert: (...args: unknown[]) => upsert(...args),
      delete: (...args: unknown[]) => del(...args),
      findMany: vi.fn(),
    },
  },
}));

describe("push subscription storage", () => {
  beforeEach(() => {
    vi.resetModules();
    upsert.mockReset();
    del.mockReset();
  });

  it("upserts by endpoint", async () => {
    upsert.mockResolvedValue({ id: "1", endpoint: "https://push.example/1" });
    const { upsertPushSubscription } = await import("@/lib/db/push");
    await upsertPushSubscription({
      endpoint: "https://push.example/1",
      p256dh: "p",
      auth: "a",
      userAgent: "test",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: "https://push.example/1" },
      }),
    );
  });

  it("deletes invalid subscriptions by endpoint", async () => {
    del.mockResolvedValue({});
    const { deletePushSubscriptionByEndpoint } = await import("@/lib/db/push");
    const ok = await deletePushSubscriptionByEndpoint("https://push.example/gone");
    expect(ok).toBe(true);
    expect(del).toHaveBeenCalled();
  });
});
