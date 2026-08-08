import { afterEach, describe, expect, it } from "vitest";
import {
  clearOpenAICreditsBlock,
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  isOpenAIRateLimitError,
  markOpenAICreditsExhausted,
} from "@/lib/ai/openai-errors";

afterEach(() => {
  clearOpenAICreditsBlock();
});

describe("OpenAI error classification", () => {
  it("treats insufficient_quota / billing messages as credits errors", () => {
    expect(
      isOpenAICreditsError({
        status: 429,
        code: "insufficient_quota",
        message: "You exceeded your current quota",
      }),
    ).toBe(true);
    expect(
      isOpenAICreditsError(new Error("no credits remaining on this API key")),
    ).toBe(true);
    expect(isOpenAICreditsError({ status: 402, message: "Payment required" })).toBe(
      true,
    );
  });

  it("does not treat bare rate-limit 429 as credits exhaustion", () => {
    const rateLimit = {
      status: 429,
      code: "rate_limit_exceeded",
      message: "Rate limit reached for requests",
    };
    expect(isOpenAICreditsError(rateLimit)).toBe(false);
    expect(isOpenAIRateLimitError(rateLimit)).toBe(true);
  });

  it("only blocks after explicit credits mark", () => {
    expect(isOpenAICreditsBlocked()).toBe(false);
    markOpenAICreditsExhausted(30);
    expect(isOpenAICreditsBlocked()).toBe(true);
  });
});
