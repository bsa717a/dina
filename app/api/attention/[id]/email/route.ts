import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  canViewAttentionEmail,
  fetchAttentionEmail,
} from "@/lib/attention/fetch-email";
import { getAttentionItem } from "@/lib/attention/store";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (user.role !== "owner") return forbidden();
  const { id } = await context.params;
  const item = await getAttentionItem(id);
  if (!item) return jsonError("Attention item not found.", 404);
  if (!canViewAttentionEmail(item.source)) {
    return jsonError("Full email view is only available for email items.", 400);
  }

  try {
    const email = await fetchAttentionEmail(item.sourceId);
    return NextResponse.json({ ok: true, email });
  } catch (error) {
    logger.error("attention_fetch_email_failed", {
      itemId: item.id,
      error: error instanceof Error ? error.message : "unknown",
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to load email.",
      500,
    );
  }
}
