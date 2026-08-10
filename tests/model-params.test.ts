import { describe, expect, it } from "vitest";
import {
  modelSupportsTemperature,
  withTemperature,
} from "@/lib/ai/model-params";

describe("model temperature support", () => {
  it("rejects temperature for gpt-5 reasoning models", () => {
    expect(modelSupportsTemperature("gpt-5-mini")).toBe(false);
    expect(modelSupportsTemperature("gpt-5")).toBe(false);
    expect(modelSupportsTemperature("gpt-5.4-nano")).toBe(false);
    expect(withTemperature("gpt-5-mini", 0.3)).toEqual({});
  });

  it("allows temperature for gpt-5-chat and gpt-4.1", () => {
    expect(modelSupportsTemperature("gpt-5-chat-latest")).toBe(true);
    expect(modelSupportsTemperature("gpt-4.1-nano")).toBe(true);
    expect(withTemperature("gpt-4.1", 0.4)).toEqual({ temperature: 0.4 });
  });

  it("rejects temperature for o-series", () => {
    expect(modelSupportsTemperature("o3-mini")).toBe(false);
    expect(modelSupportsTemperature("o4-mini")).toBe(false);
  });
});
