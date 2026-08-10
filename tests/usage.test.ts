import { describe, expect, it } from "vitest";
import {
  denverDayStartMs,
  estimateUsd,
  extractUsageFromResponse,
  formatUsageCompact,
  summarizeUsage,
  type UsageRecord,
} from "@/lib/ai/usage";

describe("openai usage helpers", () => {
  it("extracts tokens including reasoning", () => {
    const usage = extractUsageFromResponse({
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        output_tokens_details: { reasoning_tokens: 120 },
        input_tokens_details: { cached_tokens: 800 },
      },
    });
    expect(usage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      reasoningTokens: 120,
      cachedTokens: 800,
    });
  });

  it("estimates usd from local price table", () => {
    const usd = estimateUsd({
      model: "gpt-4.1-nano",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(0.1 + 0.4, 6);
  });

  it("discounts cached input tokens in estimates", () => {
    const usd = estimateUsd({
      model: "gpt-4.1-mini",
      inputTokens: 1_000_000,
      cachedTokens: 1_000_000,
      outputTokens: 0,
    });
    // cachedInput $0.10 / 1M for gpt-4.1-mini
    expect(usd).toBeCloseTo(0.1, 6);
  });

  it("summarizes by feature", () => {
    const rows: UsageRecord[] = [
      {
        ts: new Date().toISOString(),
        feature: "chat",
        model: "gpt-5-mini",
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 40,
        cachedTokens: 0,
        estUsd: 0.01,
      },
      {
        ts: new Date().toISOString(),
        feature: "morning.compose",
        model: "gpt-4.1",
        inputTokens: 200,
        outputTokens: 100,
        reasoningTokens: 0,
        cachedTokens: 0,
        estUsd: 0.05,
      },
      {
        ts: new Date().toISOString(),
        feature: "chat",
        model: "gpt-5-mini",
        inputTokens: 50,
        outputTokens: 20,
        reasoningTokens: 10,
        cachedTokens: 0,
        estUsd: 0.02,
      },
    ];
    const summary = summarizeUsage(rows);
    expect(summary[0].feature).toBe("morning.compose");
    expect(summary.find((s) => s.feature === "chat")?.calls).toBe(2);
  });

  it("formats compact usage and denver day start", () => {
    expect(
      formatUsageCompact({
        calls: 1,
        inputTokens: 12_400,
        outputTokens: 800,
        reasoningTokens: 200,
        estUsd: 0.031,
      }),
    ).toMatch(/12\.4k in/);
    expect(denverDayStartMs(new Date("2026-08-10T18:00:00Z"))).toBeLessThan(
      Date.parse("2026-08-10T18:00:00Z"),
    );
  });
});
