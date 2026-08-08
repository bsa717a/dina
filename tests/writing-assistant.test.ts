import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractWritingStyleSection } from "@/lib/writing/voice";
import { getWritingToolDefinitions } from "@/lib/writing/tool-definitions";
import { listWritingToolNames, executeWritingTool } from "@/lib/writing/tools";
import { WRITING_MEDIUMS } from "@/lib/writing/types";

describe("Writing Assistant voice pack", () => {
  it("extracts Writing Style from the operating manual", () => {
    const manual = readFileSync(
      join(process.cwd(), "dina-operating-manual.md"),
      "utf8",
    );
    const section = extractWritingStyleSection(manual);
    expect(section).toMatch(/concise/i);
    expect(section).toMatch(/one option/i);
    expect(section).not.toMatch(/^# Writing Style/);
  });

  it("falls back when section is missing", () => {
    const section = extractWritingStyleSection("# Other\n\nNo writing here.");
    expect(section).toMatch(/Derek/);
  });
});

describe("Writing Assistant tools", () => {
  it("registers draft_in_dereks_voice", () => {
    expect(listWritingToolNames()).toContain("draft_in_dereks_voice");
    expect(getWritingToolDefinitions().map((t) => t.name)).toEqual([
      "draft_in_dereks_voice",
    ]);
    const def = getWritingToolDefinitions()[0];
    const medium = (
      def.parameters as { properties?: { medium?: { enum?: string[] } } }
    ).properties?.medium?.enum;
    expect(medium).toEqual([...WRITING_MEDIUMS]);
  });

  it("requires purpose", async () => {
    const result = JSON.parse(
      await executeWritingTool(
        "draft_in_dereks_voice",
        JSON.stringify({ medium: "email" }),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/purpose/i);
  });
});
