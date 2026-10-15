/**
 * GET /api/grok/teammates
 *
 * List all teammates with name, phone (E.164), and project keys.
 * Requires service token authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { toAuthUser } from "@/lib/auth/types";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";

export const runtime = "nodejs";

export interface TeammateResponse {
  id: string;
  name: string;
  username: string;
  phoneNumber: string | null;
  slackUserId: string | null;
  projectKeys: string[];
}

export async function GET(request: NextRequest) {
  const auth = await requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const rows = await prisma.user.findMany({
    where: { role: "member" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      assistantName: true,
      assistantPersona: true,
      assistantKey: true,
      mustChangePassword: true,
      phoneNumber: true,
      slackUserId: true,
      sessionVersion: true,
    },
  });

  const actorKeys =
    auth.actor.kind === "user" && auth.actor.user.role !== "owner"
      ? new Set(await listMemberProjectKeys(auth.actor.user))
      : null;

  const teammates: TeammateResponse[] = [];
  for (const row of rows) {
    const user = toAuthUser(row);
    const projectKeys = await listMemberProjectKeys(user);
    const visibleKeys = actorKeys
      ? projectKeys.filter((key) => actorKeys.has(key))
      : projectKeys;
    if (actorKeys && visibleKeys.length === 0) continue;
    teammates.push({
      id: user.id,
      name: user.name,
      username: user.username,
      phoneNumber: row.phoneNumber ?? null,
      slackUserId: row.slackUserId ?? null,
      projectKeys: visibleKeys,
    });
  }

  return NextResponse.json({
    ok: true,
    teammates,
  });
}
