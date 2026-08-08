import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { jsonError, unauthorized } from "@/lib/http";
import { setMessageStarred } from "@/lib/stars/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Ctx) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await context.params;
  if (!id) return jsonError("Message id required.", 400);

  let body: { starred?: boolean } = {};
  try {
    body = (await request.json()) as { starred?: boolean };
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  if (typeof body.starred !== "boolean") {
    return jsonError("Body must include starred: boolean.", 400);
  }

  const result = await setMessageStarred(id, body.starred);
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
