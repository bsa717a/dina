/**
 * GET /api/grok/lookup-by-slack?slackUserId=U012ABCDEF
 *
 * Look up a teammate by Slack user id (Regi roster).
 * Requires service token authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { actorCanReachUser, visibleProjectKeys } from "@/lib/grok-api/scope";
import { lookupBySlackUserId } from "@/lib/slack/roster";
import { userCanAccessProject } from "@/lib/project-tasks/membership";
import { resolveRegiProjectKey } from "@/lib/slack/scope";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const slackUserId = request.nextUrl.searchParams.get("slackUserId");
  if (!slackUserId) {
    return jsonError("Missing required query parameter: slackUserId", 400);
  }

  const result = await lookupBySlackUserId(slackUserId);

  const miss = (id: string) =>
    NextResponse.json({
      ok: true,
      found: false,
      slackUserId: id,
      reason: "unknown_user",
    });

  if (!result.found) return miss(result.slackUserId);

  if (auth.actor.kind === "user") {
    const reach = await actorCanReachUser(auth.actor, result.user.id);
    if (reach !== "ok") return miss(result.user.slackUserId);
  }

  const canSeeRegi =
    auth.actor.kind === "service" ||
    Boolean(await userCanAccessProject(auth.actor.user, resolveRegiProjectKey()));

  return NextResponse.json({
    ok: true,
    found: true,
    user: {
      id: result.user.id,
      name: result.user.name,
      username: result.user.username,
      slackUserId: result.user.slackUserId,
    },
    projectKeys: await visibleProjectKeys(auth.actor, result.projectKeys),
    onRegiProject: canSeeRegi ? result.onRegiProject : false,
  });
}
