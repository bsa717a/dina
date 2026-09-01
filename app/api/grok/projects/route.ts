/**
 * GET /api/grok/projects
 *
 * List all active projects for Grok Bot Dina.
 * Requires service token authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { ensureProjectCatalog, listKnownProjects } from "@/lib/projects/catalog";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  await ensureProjectCatalog();
  const projects = listKnownProjects();

  return NextResponse.json({
    ok: true,
    projects: projects.map((p) => ({
      key: p.key,
      name: p.name,
      aliases: p.aliases,
    })),
  });
}
