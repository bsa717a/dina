import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { needsOnboarding } from "@/lib/auth/types";
import {
  DEFAULT_CONVERSATION_TITLE,
  getConversationWithMessages,
} from "@/lib/db/conversations";
import { checkDatabase } from "@/lib/db/client";
import { forbidden, jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (needsOnboarding(user)) return forbidden("Onboarding required.");

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  const data = await getConversationWithMessages({
    userId: user.id,
    title: user.assistantName || DEFAULT_CONVERSATION_TITLE,
  });
  if (!data) return jsonError("Conversation not found.", 404);

  return NextResponse.json({
    conversation: data.conversation,
    messages: data.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      openaiResponseId: m.openaiResponseId,
      starred: Boolean(m.starredAt),
      starredAt: m.starredAt,
      attachments: m.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      })),
    })),
  });
}
