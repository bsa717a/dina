import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { needsOnboarding } from "@/lib/auth/types";
import { checkDatabase } from "@/lib/db/client";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import {
  formatStarredMessagesMessage,
} from "@/lib/stars/format";
import {
  listStarredMessageRecords,
  STAR_SOFT_CAP,
} from "@/lib/stars/store";

export const runtime = "nodejs";

/** Cheap starred-message read. No model. */
export async function GET() {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (needsOnboarding(user)) return forbidden("Onboarding required.");
  if (user.role !== "owner") return forbidden("Starred messages are owner-only.");

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  const items = await listStarredMessageRecords(user.id);
  return NextResponse.json({
    count: items.length,
    cap: STAR_SOFT_CAP,
    items: items.map((item) => ({
      id: item.id,
      role: item.role,
      starredAt: item.starredAt,
      createdAt: item.createdAt,
      content: item.content,
    })),
    markdown: formatStarredMessagesMessage(items),
  });
}
