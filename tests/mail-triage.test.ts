import { describe, expect, it } from "vitest";
import { classifyMailNoise, partitionMailByTriage } from "@/lib/mail/triage";

describe("mail triage", () => {
  it("treats Gmail Promotions as noise", () => {
    const result = classifyMailNoise({
      subject: "This week only",
      fromAddress: "deals@shop.example",
      bodyPreview: "Shop now",
      labelIds: ["UNREAD", "CATEGORY_PROMOTIONS", "INBOX"],
    });
    expect(result.kind).toBe("noise");
    expect(result.reason).toMatch(/Promotions/i);
  });

  it("treats Gmail SPAM label as noise", () => {
    const result = classifyMailNoise({
      subject: "Hello",
      fromAddress: "friend@example.com",
      labelIds: ["SPAM"],
    });
    expect(result.kind).toBe("noise");
  });

  it("keeps personal replies as maybe_real", () => {
    const result = classifyMailNoise({
      subject: "Re: Dinner Friday",
      fromAddress: "adam@example.com",
      fromName: "Adam",
      bodyPreview: "Does 6pm work?",
      labelIds: ["UNREAD", "INBOX", "CATEGORY_PERSONAL"],
    });
    expect(result.kind).toBe("maybe_real");
  });

  it("treats HeyGen marketing as noise even without Promotions label", () => {
    const result = classifyMailNoise({
      subject: "Create your next AI avatar video",
      fromAddress: "hello@heygen.com",
      fromName: "HeyGen",
      bodyPreview: "See what’s new in HeyGen this week",
    });
    expect(result.kind).toBe("noise");
    expect(result.reason).toMatch(/heygen/i);
  });

  it("treats HeyGen subdomain and Truvani marketing as noise", () => {
    expect(
      classifyMailNoise({
        subject: "You're invited to a live session",
        fromAddress: "webinar@learn.heygen.com",
        fromName: "HeyGen",
      }).kind,
    ).toBe("noise");
    expect(
      classifyMailNoise({
        subject: "Welcome to Truvani! 🎁",
        fromAddress: "Support@truvani.com",
        fromName: "The Truvani Team",
        bodyPreview: "plant-based protein powder",
      }).kind,
    ).toBe("noise");
  });

  it("partitions mixed inbox", () => {
    const { noise, maybeReal } = partitionMailByTriage([
      {
        id: "1",
        subject: "Newsletter",
        fromAddress: "news@mailchimp.com",
        bodyPreview: "Unsubscribe anytime",
      },
      {
        id: "2",
        subject: "Re: Contract",
        fromAddress: "ceo@partner.com",
        bodyPreview: "Can you review?",
      },
    ]);
    expect(noise.map((n) => n.id)).toContain("1");
    expect(maybeReal.map((n) => n.id)).toContain("2");
  });
});
