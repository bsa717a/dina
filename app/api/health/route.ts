import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db/client";
import {
  getOpenAIApiKey,
  getVapidConfig,
  isSlackConfigured,
  isSlackSocketModeConfigured,
  isTelnyxConfigured,
} from "@/lib/env";
import { getSlackSocketStatus, slackSocketHealthFromStatus } from "@/lib/slack/socket-status";
import { checkGoogleApis } from "@/lib/google/auth";
import { checkMicrosoftGraph } from "@/lib/microsoft/graph";

export const runtime = "nodejs";

export async function GET() {
  const db = await checkDatabase();
  const openaiConfigured = Boolean(getOpenAIApiKey());
  const vapidConfigured = Boolean(getVapidConfig());
  const microsoft = await checkMicrosoftGraph();
  const google = await checkGoogleApis();

  const ok = db.ok;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      service: "dina",
      timestamp: new Date().toISOString(),
      checks: {
        database: db.ok ? "ok" : "error",
        openai: openaiConfigured ? "configured" : "missing",
        vapid: vapidConfigured ? "configured" : "missing",
        microsoft: !microsoft.configured
          ? "missing"
          : microsoft.ok
            ? "ok"
            : "error",
        google: !google.configured
          ? "missing"
          : google.ok
            ? "ok"
            : "error",
        telnyx: isTelnyxConfigured() ? "configured" : "missing",
        slack: isSlackConfigured() ? "configured" : "missing",
        slackSocket: slackSocketHealthFromStatus(isSlackSocketModeConfigured(), getSlackSocketStatus()),
      },
      ...(db.error ? { databaseError: "unavailable" } : {}),
      ...(microsoft.configured && !microsoft.ok
        ? { microsoftError: "unavailable" }
        : {}),
      ...(google.configured && !google.ok
        ? { googleError: "unavailable" }
        : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
