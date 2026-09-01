/**
 * GET /api/grok/projects/[key]/tasks
 *
 * List open/in-progress tasks for a project.
 * Requires service token authentication.
 *
 * Query params:
 *   - status: comma-separated list of statuses (default: open,in_progress)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/grok-api/auth";
import {
  ensureProjectCatalog,
  resolveProjectKey,
} from "@/lib/projects/catalog";
import { listProjectTasks } from "@/lib/project-tasks/store";
import { PROJECT_TASK_STATUSES, type ProjectTaskStatus } from "@/lib/project-tasks/types";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ key: string }>;
}

export async function GET(request: NextRequest, context: RouteParams) {
  const auth = requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const { key: rawKey } = await context.params;

  await ensureProjectCatalog();
  const projectKey = resolveProjectKey(rawKey);
  if (!projectKey) {
    return jsonError(`Unknown project: "${rawKey}"`, 404);
  }

  const statusParam = request.nextUrl.searchParams.get("status");
  let statuses: ProjectTaskStatus[] = ["open", "in_progress"];

  if (statusParam) {
    const requested = statusParam.split(",").map((s) => s.trim().toLowerCase());
    const validStatuses = requested.filter((s): s is ProjectTaskStatus =>
      PROJECT_TASK_STATUSES.includes(s as ProjectTaskStatus),
    );
    if (validStatuses.length > 0) {
      statuses = validStatuses;
    }
  }

  const tasks = await listProjectTasks({
    project: projectKey,
    statuses,
  });

  return NextResponse.json({
    ok: true,
    projectKey,
    tasks: tasks.map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      description: t.description,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  });
}
