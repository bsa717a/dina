import { describe, expect, it } from "vitest";
import {
  classifyMailNoise,
  partitionMailByTriage,
} from "@/lib/microsoft/mail-triage";

describe("mail triage", () => {
  it("marks obvious marketing as noise", () => {
    const result = classifyMailNoise({
      subject: "Flash sale — 40% off this weekend",
      fromAddress: "newsletter@mail.store.com",
      bodyPreview: "Shop now before it's gone. Unsubscribe anytime.",
      inferenceClassification: "other",
    });
    expect(result.kind).toBe("noise");
    expect(result.score).toBeGreaterThanOrEqual(4);
  });

  it("marks ESP blasts as noise", () => {
    const result = classifyMailNoise({
      subject: "Your weekly product updates",
      fromAddress: "updates@mg.mailgun.org",
      bodyPreview: "View in browser · Manage preferences",
    });
    expect(result.kind).toBe("noise");
  });

  it("keeps personal reply threads as maybe_real", () => {
    const result = classifyMailNoise({
      subject: "Re: Login issue for district admins",
      fromAddress: "justin@schooldistrict.org",
      fromName: "Justin",
      bodyPreview: "Thanks — can you jump on a call tomorrow?",
      inferenceClassification: "focused",
    });
    expect(result.kind).toBe("maybe_real");
  });

  it("does not bury uncertain mail (bias to maybe_real)", () => {
    const result = classifyMailNoise({
      subject: "Quick question",
      fromAddress: "hello@acme.io",
      bodyPreview: "Wanted to follow up on our conversation.",
    });
    expect(result.kind).toBe("maybe_real");
  });

  it("partitions a mixed inbox", () => {
    const { noise, maybeReal } = partitionMailByTriage([
      {
        id: "1",
        subject: "Newsletter: March roundup",
        fromAddress: "news@brand.com",
        bodyPreview: "Unsubscribe · View in browser",
      },
      {
        id: "2",
        subject: "Re: Contract signature",
        fromAddress: "adam@4studentlives.com",
        bodyPreview: "Please review the attached redlines.",
      },
    ]);
    expect(noise.map((m) => m.id)).toEqual(["1"]);
    expect(maybeReal.map((m) => m.id)).toEqual(["2"]);
  });
});
