/**
 * GET /api/grok/projects
 *
 * List active projects. The env Dina token sees every project.
 * A per-user token sees only that user's projects.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { projectsVisibleToActor } from "@/lib/grok-api/scope";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const projects = await projectsVisibleToActor(auth.actor);

  return NextResponse.json({
    ok: true,
    projects: projects.map((p) => ({
      key: p.key,
      name: p.name,
      aliases: p.aliases,
    })),
  });
}
