import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getVapidConfig } from "@/lib/env";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { logger } from "@/lib/logger";
import { sendPushToAll } from "@/lib/push/web-push";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (user.role !== "owner") return forbidden();
  if (!getVapidConfig()) return jsonError("Push is not configured.", 503);

  try {
    const result = await sendPushToAll({
      title: "Dina",
      body: "This is a test notification.",
      url: "/",
      target: { type: "conversation" },
    });
    logger.info("push_test_sent", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logger.error("push_test_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return jsonError("Failed to send test notification.", 500);
  }
}
