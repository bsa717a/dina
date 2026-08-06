import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getConversationWithMessages } from "@/lib/db/conversations";
import { checkDatabase } from "@/lib/db/client";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  if (!(await requireSession())) return unauthorized();

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  const data = await getConversationWithMessages();
  if (!data) return jsonError("Conversation not found.", 404);

  return NextResponse.json({
    conversation: data.conversation,
    messages: data.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      openaiResponseId: m.openaiResponseId,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
    })),
  });
}
