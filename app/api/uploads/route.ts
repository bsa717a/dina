import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { checkDatabase } from "@/lib/db/client";
import { jsonError, unauthorized } from "@/lib/http";
import { logger } from "@/lib/logger";
import { storeUpload } from "@/lib/uploads/storage";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Invalid multipart form data.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError("file is required.");
  }

  try {
    const result = await storeUpload(file);
    if (!result.ok) {
      return jsonError(result.error, 400);
    }

    return NextResponse.json({
      attachment: {
        id: result.attachment.id,
        filename: result.attachment.filename,
        mimeType: result.attachment.mimeType,
        size: result.attachment.size,
        kind: result.attachment.kind,
      },
    });
  } catch (error) {
    logger.error("upload_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return jsonError("Failed to store upload.", 500);
  }
}
