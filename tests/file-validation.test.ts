import { describe, expect, it } from "vitest";
import { validateUpload } from "@/lib/uploads/validation";

describe("validateUpload", () => {
  it("allows jpeg images under the size limit", () => {
    const result = validateUpload({
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      size: 1024,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("image");
  });

  it("allows pdf and text files", () => {
    expect(
      validateUpload({ filename: "notes.md", mimeType: "text/markdown", size: 100 }).ok,
    ).toBe(true);
    expect(
      validateUpload({ filename: "doc.pdf", mimeType: "application/pdf", size: 100 }).ok,
    ).toBe(true);
  });

  it("rejects office documents with a clear message", () => {
    const result = validateUpload({
      filename: "report.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("office");
    }
  });

  it("rejects oversized images", () => {
    const result = validateUpload({
      filename: "huge.png",
      mimeType: "image/png",
      size: 20 * 1024 * 1024,
    });
    expect(result.ok).toBe(false);
  });
});
