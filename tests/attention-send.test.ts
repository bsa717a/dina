import { describe, expect, it } from "vitest";
import {
  canSendAttentionDraft,
  graphIdFromSourceId,
  recipientFromAttentionRaw,
} from "@/lib/attention/send";

describe("attention send helpers", () => {
  it("allows email and meeting drafts, not github", () => {
    expect(canSendAttentionDraft("email")).toBe(true);
    expect(canSendAttentionDraft("meeting_invite")).toBe(true);
    expect(canSendAttentionDraft("calendar")).toBe(true);
    expect(canSendAttentionDraft("github")).toBe(false);
    expect(canSendAttentionDraft("todo")).toBe(false);
  });

  it("strips microsoft365 prefixes from source ids", () => {
    expect(graphIdFromSourceId("microsoft365:email:ABC123")).toBe("ABC123");
    expect(graphIdFromSourceId("microsoft365:calendar:EVT")).toBe("EVT");
    expect(graphIdFromSourceId("plain-id")).toBe("plain-id");
  });

  it("resolves recipient from raw payload fields", () => {
    expect(
      recipientFromAttentionRaw(
        JSON.stringify({ senderEmail: "tim@example.com" }),
        "Tim",
      ),
    ).toBe("tim@example.com");
    expect(
      recipientFromAttentionRaw(
        JSON.stringify({
          payload: { organizerAddress: "org@example.com" },
        }),
        "Organizer",
      ),
    ).toBe("org@example.com");
    expect(recipientFromAttentionRaw(null, "person@school.edu")).toBe(
      "person@school.edu",
    );
  });
});
