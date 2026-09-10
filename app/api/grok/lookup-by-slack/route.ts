/**
 * GET /api/grok/lookup-by-slack?slackUserId=U012ABCDEF
 *
 * Look up a teammate by Slack user id (Regi roster).
 * Requires service token authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { lookupBySlackUserId } from "@/lib/slack/roster";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const slackUserId = request.nextUrl.searchParams.get("slackUserId");
  if (!slackUserId) {
    return jsonError("Missing required query parameter: slackUserId", 400);
  }

  const result = await lookupBySlackUserId(slackUserId);

  if (!result.found) {
    return NextResponse.json({
      ok: true,
      found: false,
      slackUserId: result.slackUserId,
      reason: result.reason,
    });
  }

  return NextResponse.json({
    ok: true,
    found: true,
    user: {
      id: result.user.id,
      name: result.user.name,
      username: result.user.username,
      slackUserId: result.user.slackUserId,
    },
    projectKeys: result.projectKeys,
    onRegiProject: result.onRegiProject,
  });
}
