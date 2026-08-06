import type { AttachmentKind } from "@/lib/uploads/validation";
import { logger } from "@/lib/logger";

export async function extractAttachmentContent(input: {
  mimeType: string;
  kind: AttachmentKind;
  bytes: Buffer;
  filename: string;
}): Promise<{ textContent?: string; dataUrl?: string }> {
  if (input.kind === "image") {
    const base64 = input.bytes.toString("base64");
    const mime = input.mimeType || "image/jpeg";
    return { dataUrl: `data:${mime};base64,${base64}` };
  }

  if (input.kind === "text") {
    return { textContent: input.bytes.toString("utf8").slice(0, 200_000) };
  }

  if (input.kind === "pdf") {
    try {
      // pdf-parse v1 default export
      const pdfParse = (await import("pdf-parse")).default as (
        data: Buffer,
      ) => Promise<{ text: string }>;
      const parsed = await pdfParse(input.bytes);
      const text = (parsed.text || "").trim();
      if (!text) {
        return {
          textContent: `[PDF "${input.filename}" had no extractable text.]`,
        };
      }
      return { textContent: text.slice(0, 200_000) };
    } catch (error) {
      logger.warn("pdf_extract_failed", {
        filename: input.filename,
        error: error instanceof Error ? error.message : "unknown",
      });
      return {
        textContent: `[Could not extract text from PDF "${input.filename}".]`,
      };
    }
  }

  return {};
}
