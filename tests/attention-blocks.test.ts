import { describe, expect, it } from "vitest";
import {
  addressMatchesBlocks,
  parseAttentionBlockTarget,
  partitionByAttentionBlocks,
} from "@/lib/attention/blocks";
import {
  attentionProviderFromSourceId,
  providerIdFromSourceId,
} from "@/lib/attention/provider";

describe("attention blocks", () => {
  it("parses sender and domain targets", () => {
    expect(parseAttentionBlockTarget("Alice@Example.COM")).toEqual({
      kind: "sender",
      value: "alice@example.com",
    });
    expect(parseAttentionBlockTarget("@Newsletters.com")).toEqual({
      kind: "domain",
      value: "newsletters.com",
    });
    expect(parseAttentionBlockTarget("newsletters.com")).toEqual({
      kind: "domain",
      value: "newsletters.com",
    });
    expect(parseAttentionBlockTarget("not-an-email")).toBeNull();
  });

  it("matches sender and domain blocks", () => {
    const blocks = [
      { kind: "sender", value: "spam@promo.com" },
      { kind: "domain", value: "ads.example" },
    ];
    expect(addressMatchesBlocks("spam@promo.com", blocks).blocked).toBe(true);
    expect(addressMatchesBlocks("x@ads.example", blocks).blocked).toBe(true);
    expect(addressMatchesBlocks("friend@work.com", blocks).blocked).toBe(false);
  });

  it("matches domain blocks against subdomains", () => {
    const blocks = [{ kind: "domain", value: "heygen.com" }];
    expect(addressMatchesBlocks("webinar@learn.heygen.com", blocks).blocked).toBe(
      true,
    );
    expect(addressMatchesBlocks("hello@heygen.com", blocks).blocked).toBe(true);
    expect(addressMatchesBlocks("a@notheygen.com", blocks).blocked).toBe(false);
  });

  it("partitions blocked senders", () => {
    const { blocked, allowed } = partitionByAttentionBlocks(
      [
        { id: "1", fromAddress: "a@blocked.com" },
        { id: "2", fromAddress: "ok@example.com" },
      ],
      [{ kind: "domain", value: "blocked.com" }],
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.id).toBe("1");
    expect(allowed).toHaveLength(1);
    expect(allowed[0]?.id).toBe("2");
  });
});

describe("attention provider routing", () => {
  it("parses google and microsoft source ids", () => {
    expect(attentionProviderFromSourceId("google:email:abc")).toBe("google");
    expect(attentionProviderFromSourceId("microsoft365:email:xyz")).toBe(
      "microsoft365",
    );
    expect(providerIdFromSourceId("google:email:abc123")).toBe("abc123");
    expect(providerIdFromSourceId("microsoft365:calendar:evt")).toBe("evt");
  });
});
