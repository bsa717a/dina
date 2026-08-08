import { describe, expect, it } from "vitest";
import {
  buildExcelWorkbook,
  buildPowerPointPresentation,
  buildWordDocument,
  expandTextToWordBlocks,
  extractExcelSheets,
  extractPowerPointText,
  extractWordText,
  resolveOfficeUploadPath,
} from "@/lib/microsoft/office";

function startsWithPk(buffer: Buffer) {
  return buffer.subarray(0, 2).toString("utf8") === "PK";
}

describe("office document generators", () => {
  it("builds a valid docx zip and extracts text", async () => {
    const buffer = await buildWordDocument({
      title: "Status Note",
      paragraphs: ["Hello from Dina.", "Second paragraph."],
    });
    expect(buffer.byteLength).toBeGreaterThan(100);
    expect(startsWithPk(buffer)).toBe(true);
    const text = await extractWordText(buffer);
    expect(text).toContain("Status Note");
    expect(text).toContain("Hello from Dina.");
  });

  it("builds a valid xlsx zip and reads rows", async () => {
    const buffer = await buildExcelWorkbook([
      {
        name: "Numbers",
        rows: [
          ["Name", "Score"],
          ["Ada", 10],
          ["Grace", 12],
        ],
      },
    ]);
    expect(startsWithPk(buffer)).toBe(true);
    const sheets = await extractExcelSheets(buffer);
    expect(sheets[0]?.name).toBe("Numbers");
    expect(sheets[0]?.rows[0]).toEqual(["Name", "Score"]);
    expect(sheets[0]?.rows[1]?.[0]).toBe("Ada");
  });

  it("builds a valid pptx zip and extracts slide text", async () => {
    const buffer = await buildPowerPointPresentation({
      title: "Kickoff",
      slides: [{ title: "Agenda", bullets: ["Goals", "Timeline"] }],
    });
    expect(startsWithPk(buffer)).toBe(true);
    const slides = extractPowerPointText(buffer);
    expect(slides.length).toBeGreaterThan(0);
    const joined = slides.flatMap((s) => s.text).join(" ");
    expect(joined).toMatch(/Agenda|Goals|Timeline/);
  });

  it("resolves default paths to OneDrive My files root", () => {
    expect(resolveOfficeUploadPath(undefined, "Notes.docx", ".docx")).toBe(
      "Notes.docx",
    );
    expect(resolveOfficeUploadPath("Projects/plan", "x", ".xlsx")).toBe(
      "Projects/plan.xlsx",
    );
  });

  it("expands markdown-ish lines into headings and bullets", async () => {
    const blocks = expandTextToWordBlocks(
      "1. Scriptures\n- John 3:16\n## Blessings\nA short note.",
    );
    expect(blocks[0]).toMatchObject({ type: "heading" });
    expect(blocks[1]).toMatchObject({ type: "bullet", text: "John 3:16" });
    const buffer = await buildWordDocument({
      title: "Lesson",
      paragraphs: ["1. Scriptures\n- John 3:16\nA short note."],
    });
    expect(startsWithPk(buffer)).toBe(true);
    const text = await extractWordText(buffer);
    expect(text).toContain("Scriptures");
    expect(text).toContain("John 3:16");
  });
});
