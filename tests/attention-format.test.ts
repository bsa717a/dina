import { describe, expect, it } from "vitest";
import { formatAttentionWhen } from "@/lib/attention/format";

describe("formatAttentionWhen", () => {
  it("formats calendar start/end wall-clock times", () => {
    const label = formatAttentionWhen(
      "2026-08-07T14:30:00.0000000",
      "2026-08-07T15:30:00.0000000",
    );
    expect(label).toMatch(/Aug/);
    expect(label).toMatch(/7/);
    expect(label).toContain("–");
  });

  it("formats start-only when end is missing", () => {
    const label = formatAttentionWhen("2026-08-07T09:00:00");
    expect(label).toBeTruthy();
    expect(label).not.toContain("–");
  });
});
