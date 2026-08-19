import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_HISTORY_WINDOW } from "@/lib/ai/history";
import {
  formatStarredMessagesMessage,
  formatStarredMessagesRuntime,
  isStarredListChatContent,
  isStarredListRequest,
} from "@/lib/stars/format";
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

  it("keeps recent chat history short so first tokens stay cheap", () => {
    expect(CHAT_HISTORY_WINDOW).toBe(32);
  });

  it("formats starred messages for session runtime and the user", () => {
    const item = {
      id: "s1",
      role: "assistant",
      conversationId: "c1",
      createdAt: new Date("2026-08-18T18:00:00.000Z"),
      starredAt: new Date("2026-08-18T18:00:00.000Z"),
      content: "Keep this lesson list.",
    };
    const runtime = formatStarredMessagesRuntime([item]);
    expect(runtime).toContain("already loaded");
    expect(runtime).toContain("Keep this lesson list.");
    expect(runtime).toContain("Do not call list_starred_messages");
    expect(formatStarredMessagesMessage([])).toMatch(/No starred messages/);
    expect(formatStarredMessagesMessage([item])).toContain(
      "Keep this lesson list.",
    );
  });

  it("detects starred list asks and skips export phrasing", () => {
    expect(isStarredListRequest("Show starred messages")).toBe(true);
    expect(isStarredListRequest("what did I star")).toBe(true);
    expect(isStarredListRequest("starred")).toBe(true);
    expect(isStarredListRequest("pull up my pins")).toBe(true);
    expect(isStarredListRequest("get starred messages")).toBe(true);
    expect(
      isStarredListRequest("put the starred list in a Word doc"),
    ).toBe(false);
    expect(isStarredListRequest("show starred messages and summarize them")).toBe(
      false,
    );
    expect(isStarredListRequest("get starred message star-1")).toBe(false);
    expect(isStarredListRequest("star the last message")).toBe(false);
    expect(
      isStarredListChatContent(
        "assistant",
        "Starred messages (1 of 20):\n\n1. Assistant · Aug 18\nKeep this.",
      ),
    ).toBe(true);
  });

  it("returns unknown tool error", async () => {
    const { executeStarTool } = await import("@/lib/stars/tools");
    const result = JSON.parse(await executeStarTool("nope", "{}"));
    expect(result.ok).toBe(false);
  });
});
