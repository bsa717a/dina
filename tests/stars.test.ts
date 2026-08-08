import { afterEach, describe, expect, it, vi } from "vitest";
import { getStarToolDefinitions } from "@/lib/stars/tool-definitions";
import { STAR_SOFT_CAP } from "@/lib/stars/store";

describe("star tools", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("exposes list/get/unstar tools", () => {
    const names = getStarToolDefinitions().map((t) => t.name);
    expect(names).toEqual([
      "list_starred_messages",
      "get_starred_message",
      "unstar_message",
    ]);
  });

  it("uses a soft cap of 20", () => {
    expect(STAR_SOFT_CAP).toBe(20);
  });

  it("returns unknown tool error", async () => {
    const { executeStarTool } = await import("@/lib/stars/tools");
    const result = JSON.parse(await executeStarTool("nope", "{}"));
    expect(result.ok).toBe(false);
  });
});
