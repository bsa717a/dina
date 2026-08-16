import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db/client";
import { kindFromMime, validateUpload } from "@/lib/uploads/validation";

export function getUploadsDir() {
  return path.join(process.cwd(), "data", "uploads");
}

export async function ensureUploadsDir() {
  await mkdir(getUploadsDir(), { recursive: true });
}

function safeStorageKey(filename: string) {
  const ext = path.extname(filename).toLowerCase().slice(0, 12);
  return `${randomUUID()}${ext}`;
}

export async function storeUpload(file: File, uploadedByUserId: string) {
  const validation = validateUpload({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
  });
  if (!validation.ok) {
    return { ok: false as const, error: validation.error };
  }

  await ensureUploadsDir();
  const storageKey = safeStorageKey(file.name);
  const absolutePath = path.join(getUploadsDir(), storageKey);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, buffer);

  const attachment = await prisma.attachment.create({
    data: {
      filename: file.name,
      mimeType: validation.mimeType,
      size: file.size,
      storageKey,
      uploadedByUserId,
    },
  });

  return {
    ok: true as const,
    attachment: {
      ...attachment,
      kind: validation.kind,
    },
  };
}

export function resolveStoragePath(storageKey: string) {
  if (
    !storageKey ||
    storageKey.includes("..") ||
    storageKey.includes("/") ||
    storageKey.includes("\\")
  ) {
    throw new Error("Invalid storage key");
  }
  return path.join(getUploadsDir(), storageKey);
}

export async function readAttachmentBytes(storageKey: string) {
  const filePath = resolveStoragePath(storageKey);
  return readFile(filePath);
}

export async function loadProviderAttachments(
  attachmentIds: string[],
  uploadedByUserId: string,
) {
  if (!attachmentIds.length) return [];
  const rows = await prisma.attachment.findMany({
    where: { id: { in: attachmentIds }, uploadedByUserId },
  });

  const { extractAttachmentContent } = await import("@/lib/uploads/extract");

  const result = [];
  for (const row of rows) {
    const bytes = await readAttachmentBytes(row.storageKey);
    const kind = kindFromMime(row.mimeType);
    const extracted = await extractAttachmentContent({
      mimeType: row.mimeType,
      kind,
      bytes,
      filename: row.filename,
    });
    result.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      size: row.size,
      storageKey: row.storageKey,
      kind,
      textContent: extracted.textContent,
      dataUrl: extracted.dataUrl,
    });
  }
  return result;
}
