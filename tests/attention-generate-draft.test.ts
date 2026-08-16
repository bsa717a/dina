import { describe, expect, it } from "vitest";
import { attentionDraftRequest } from "@/lib/attention/generate-draft";

describe("attentionDraftRequest", () => {
  it("builds an email draft request from the card, not a scan payload", () => {
    const request = attentionDraftRequest({
      source: "email",
      sender: "Justin <justin@example.com>",
      subject: "Beacon timeline",
      summary: "Can you confirm Friday?",
      whyItMatters: "Justin is waiting.",
      recommendedAction: "Confirm Friday or propose Monday.",
      rawJson: JSON.stringify({ payload: { fromAddress: "justin@example.com" } }),
    });

    expect(request.medium).toBe("email");
    expect(request.to).toBe("justin@example.com");
    expect(request.purpose).toContain("Reply to: Beacon timeline");
    expect(request.purpose).toContain("Project: Justin is waiting.");
    expect(request.points).toEqual(["Can you confirm Friday?"]);
  });
});
