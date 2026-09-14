import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { needsOnboarding } from "@/lib/auth/types";
import { checkDatabase } from "@/lib/db/client";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { resolveActiveProjectForUser } from "@/lib/chat/active-project";
import { streamChatTurnResponse } from "@/lib/chat/run-turn";

export const runtime = "nodejs";
/**
 * Morning Ritual runs week-plan + markets in parallel then compose.
 * Budget target is well under 300s (see lib/morning-ritual timeouts).
 */
export const maxDuration = 300;

const bodySchema = z.object({
  content: z.string().max(50_000).default(""),
  attachmentIds: z.array(z.string()).max(8).default([]),
  project: z.string().max(80).optional(),
});

export async function POST(request: NextRequest) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (needsOnboarding(user)) return forbidden("Onboarding required.");

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Invalid chat request.");
  }

  const content = parsed.data.content.trim();
  if (!content && parsed.data.attachmentIds.length === 0) {
    return jsonError("Message or attachment is required.");
  }

  const requestedProject = parsed.data.project?.trim();
  const activeProject = await resolveActiveProjectForUser(
    user,
    requestedProject,
  );
  if (requestedProject && !activeProject) {
    return jsonError("Unknown project or no access.", 400);
  }

  return streamChatTurnResponse({
    user,
    content,
    attachmentIds: parsed.data.attachmentIds,
    activeProject,
    signal: request.signal,
  });
}
