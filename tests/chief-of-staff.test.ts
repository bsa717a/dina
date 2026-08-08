import { describe, expect, it } from "vitest";
import {
  DISPOSITIONS,
  NORMALIZED_EVENT_TYPES,
  dispositionLabel,
  type NormalizedEvent,
} from "@/lib/chief-of-staff/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Chief of Staff Engine contracts", () => {
  it("defines the normalized event vocabulary", () => {
    expect(NORMALIZED_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "NewEmail",
        "EmailThreadUpdated",
        "CalendarChanged",
        "MeetingInvitation",
        "PullRequestOpened",
        "PullRequestReadyForReview",
        "WorkflowFailed",
        "WorkflowSucceeded",
        "IssueAssigned",
        "AgentCompletedTask",
        "RepositoryInactive",
        "ReminderDue",
        "FileShared",
      ]),
    );
  });

  it("defines exactly the five dispositions", () => {
    expect([...DISPOSITIONS]).toEqual([
      "create_attention_card",
      "add_to_todays_briefing",
      "update_project_context",
      "store_as_context",
      "ignore",
    ]);
    expect(dispositionLabel("create_attention_card")).toBe(
      "Create Attention Card",
    );
  });

  it("keeps vendor APIs out of the Chief of Staff Engine module", () => {
    const enginePath = resolve(
      process.cwd(),
      "lib/chief-of-staff/engine.ts",
    );
    const decidePath = resolve(
      process.cwd(),
      "lib/chief-of-staff/decide.ts",
    );
    const engineSrc = readFileSync(enginePath, "utf8");
    const decideSrc = readFileSync(decidePath, "utf8");

    for (const src of [engineSrc, decideSrc]) {
      expect(src).not.toMatch(/lib\/microsoft\/graph/);
      expect(src).not.toMatch(/lib\/github\/client/);
      expect(src).not.toMatch(/api\.github\.com/);
      expect(src).not.toMatch(/graph\.microsoft\.com/);
    }
  });

  it("treats connector provenance as optional audit, not decision input shape", () => {
    const event: NormalizedEvent = {
      eventId: "test:1",
      type: "WorkflowFailed",
      occurredAt: new Date().toISOString(),
      title: "CI failed",
      summary: "Beacon workflow failed on main",
      projectHint: "4studentlives:4studentlives/beacon",
      connector: "github",
    };
    expect(event.type).toBe("WorkflowFailed");
    expect(event.connector).toBe("github");
  });
});
