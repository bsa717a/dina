import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db/client";
import { getOpenAIApiKey, getVapidConfig } from "@/lib/env";
import { checkMicrosoftGraph } from "@/lib/microsoft/graph";

export const runtime = "nodejs";

export async function GET() {
  const db = await checkDatabase();
  const openaiConfigured = Boolean(getOpenAIApiKey());
  const vapidConfigured = Boolean(getVapidConfig());
  const microsoft = await checkMicrosoftGraph();

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
      },
      ...(db.error ? { databaseError: "unavailable" } : {}),
      ...(microsoft.configured && !microsoft.ok
        ? { microsoftError: "unavailable" }
        : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
