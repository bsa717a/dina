import { NextResponse } from "next/server";
import { requireReadySession } from "@/lib/auth/session";
import { conversationOwnedByUser } from "@/lib/db/conversations";
import { jsonError } from "@/lib/http";
import { prisma } from "@/lib/db/client";
import { setMessageStarred } from "@/lib/stars/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Ctx) {
  const ready = await requireReadySession();
  if (!ready.ok) return ready.response;
  const user = ready.user;
  const { id } = await context.params;
  if (!id) return jsonError("Message id required.", 400);
  const message = await prisma.message.findUnique({
    where: { id },
    select: { conversationId: true },
  });
  if (!message) return jsonError("Message not found.", 404);
  if (!(await conversationOwnedByUser(message.conversationId, user.id))) {
    return jsonError("Message not found.", 404);
  }

  let body: { starred?: boolean } = {};
  try {
    body = (await request.json()) as { starred?: boolean };
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  if (typeof body.starred !== "boolean") {
    return jsonError("Body must include starred: boolean.", 400);
  }

  const result = await setMessageStarred(id, body.starred, user.id);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        count: "count" in result ? result.count : undefined,
        cap: "cap" in result ? result.cap : undefined,
        starred: "starred" in result ? result.starred : undefined,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    starred: result.starred,
    count: result.count,
    cap: result.cap,
    messageId: id,
  });
}
