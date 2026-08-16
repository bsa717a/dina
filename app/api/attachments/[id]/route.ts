import { NextRequest, NextResponse } from "next/server";
import { requireReadySession } from "@/lib/auth/session";
import { conversationOwnedByUser } from "@/lib/db/conversations";
import { prisma } from "@/lib/db/client";
import { jsonError } from "@/lib/http";
import { readAttachmentBytes } from "@/lib/uploads/storage";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ready = await requireReadySession();
  if (!ready.ok) return ready.response;
  const user = ready.user;

  const { id } = await context.params;
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) return jsonError("Attachment not found.", 404);
  if (attachment.messageId) {
    const message = await prisma.message.findUnique({
      where: { id: attachment.messageId },
      select: { conversationId: true },
    });
    if (
      !message ||
      !(await conversationOwnedByUser(message.conversationId, user.id))
    ) {
      return jsonError("Attachment not found.", 404);
    }
  } else if (attachment.uploadedByUserId === user.id) {
    // Uploader can fetch their own pending file.
  } else if (!attachment.uploadedByUserId && user.role === "owner") {
    // Legacy rows imported before uploader was recorded.
  } else {
    return jsonError("Attachment not found.", 404);
  }

  try {
    const bytes = await readAttachmentBytes(attachment.storageKey);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.size),
        "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return jsonError("Attachment file missing.", 404);
  }
}
