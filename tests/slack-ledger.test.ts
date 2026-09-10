import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  prisma: {
    attentionItem: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    projectTask: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/project-tasks/store", () => ({
  addProjectTask: vi.fn(),
  listProjectTasks: vi.fn(),
  updateProjectTask: vi.fn(),
}));

vi.mock("@/lib/slack/scope", () => ({
  resolveRegiProjectKey: () => "regi",
}));

import {
  slackThreadSourceId,
  stripSlackMentions,
  titleFromSlackText,
} from "@/lib/slack/ledger";

describe("slack ledger helpers", () => {
  it("keys a thread by channel + thread ts", () => {
    expect(slackThreadSourceId("CREGI", "171.1")).toBe("CREGI:171.1");
  });

  it("strips bot mentions from inbound text", () => {
    expect(stripSlackMentions("<@U0BOT> add a task")).toBe("add a task");
  });

  it("builds a short task title from the first line", () => {
    expect(titleFromSlackText("<@U0BOT> polish the dashboard\nmore", "1.1")).toBe(
      "polish the dashboard",
    );
  });

  it("falls back when the mention is the whole message", () => {
    expect(titleFromSlackText("<@U0BOT>", "171.99")).toBe("Slack thread 171.99");
  });
});
