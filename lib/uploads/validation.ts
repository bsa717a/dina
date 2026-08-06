export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
]);

const PDF_TYPES = new Set(["application/pdf"]);

const OFFICE_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type AttachmentKind = "image" | "text" | "pdf" | "other";

export type ValidationResult =
  | { ok: true; mimeType: string; kind: AttachmentKind; maxBytes: number }
  | { ok: false; error: string };

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

export function resolveMimeType(filename: string, declaredMime?: string | null): string {
  const fromExt = EXT_MIME[extensionOf(filename)];
  if (declaredMime && declaredMime !== "application/octet-stream") return declaredMime;
  return fromExt || declaredMime || "application/octet-stream";
}

export function validateUpload(input: {
  filename: string;
  mimeType?: string | null;
  size: number;
}): ValidationResult {
  if (!input.filename?.trim()) {
    return { ok: false, error: "Filename is required." };
  }
  if (input.size <= 0) {
    return { ok: false, error: "File is empty." };
  }

  const mimeType = resolveMimeType(input.filename, input.mimeType);

  if (OFFICE_TYPES.has(mimeType) || [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].includes(extensionOf(input.filename))) {
    return {
      ok: false,
      error:
        "Office documents are not supported yet. Please upload a PDF, image, or plain text/Markdown file.",
    };
  }

  if (IMAGE_TYPES.has(mimeType)) {
    if (input.size > IMAGE_MAX_BYTES) {
      return { ok: false, error: "Images must be 10 MB or smaller." };
    }
    return { ok: true, mimeType, kind: "image", maxBytes: IMAGE_MAX_BYTES };
  }

  if (PDF_TYPES.has(mimeType)) {
    if (input.size > DOCUMENT_MAX_BYTES) {
      return { ok: false, error: "PDFs must be 15 MB or smaller." };
    }
    return { ok: true, mimeType, kind: "pdf", maxBytes: DOCUMENT_MAX_BYTES };
  }

  if (TEXT_TYPES.has(mimeType) || [".txt", ".md", ".markdown", ".json"].includes(extensionOf(input.filename))) {
    if (input.size > DOCUMENT_MAX_BYTES) {
      return { ok: false, error: "Text files must be 15 MB or smaller." };
    }
    return { ok: true, mimeType: mimeType || "text/plain", kind: "text", maxBytes: DOCUMENT_MAX_BYTES };
  }

  return {
    ok: false,
    error: "Unsupported file type. Use an image, PDF, or text/Markdown file.",
  };
}

export function kindFromMime(mimeType: string): AttachmentKind {
  if (IMAGE_TYPES.has(mimeType)) return "image";
  if (PDF_TYPES.has(mimeType)) return "pdf";
  if (TEXT_TYPES.has(mimeType)) return "text";
  return "other";
}
