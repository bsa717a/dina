import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireReadySession } from "@/lib/auth/session";
import { canMemberWriteCategory, memoryScopeForUser } from "@/lib/memory/scope";
import { createOrCorrectMemory, listMemories } from "@/lib/memory/store";
import { MEMORY_CATEGORIES, MEMORY_IMPORTANCE } from "@/lib/memory/types";
import { forbidden, jsonError } from "@/lib/http";
import { ensureProjectCatalog, resolveProjectKey } from "@/lib/project-tasks/keys";
import { userCanAccessProject } from "@/lib/project-tasks/membership";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ready = await requireReadySession();
  if (!ready.ok) return ready.response;
  const user = ready.user;
  const category = request.nextUrl.searchParams.get("category") || undefined;
  const status = request.nextUrl.searchParams.get("status") || "active";
  const memories = await listMemories({
    category,
    status,
    limit: 200,
    scope: await memoryScopeForUser(user),
  });
  return NextResponse.json({
    memories,
    categories: MEMORY_CATEGORIES,
  });
}

const createSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(20_000),
  source: z.string().min(1).max(100).default("manual"),
  confidence: z.number().min(0).max(1).default(0.8),
  importance: z.enum(MEMORY_IMPORTANCE).default("normal"),
  relatedIds: z.array(z.string()).optional(),
  correctId: z.string().optional(),
  project: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const ready = await requireReadySession();
  if (!ready.ok) return ready.response;
  const user = ready.user;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid memory payload.");
  await ensureProjectCatalog();

  try {
    if (user.role === "member") {
      if (!canMemberWriteCategory(parsed.data.category)) {
        return forbidden(
          "Members can only store project, decision, commitment, or people memories.",
        );
      }
      const projectKey = parsed.data.project
        ? await userCanAccessProject(user, parsed.data.project)
        : null;
      if (!projectKey || !(await userCanAccessProject(user, projectKey))) {
        return forbidden("project is required and must be an assigned project.");
      }
      const memory = await createOrCorrectMemory(
        {
          ...parsed.data,
          ownerUserId: user.id,
          projectKey,
        },
        { scope: await memoryScopeForUser(user) },
      );
      return NextResponse.json({ memory });
    }
    const memory = await createOrCorrectMemory({
      ...parsed.data,
      ownerUserId: user.id,
      projectKey: parsed.data.project
        ? resolveProjectKey(parsed.data.project)
        : null,
    });
    return NextResponse.json({ memory });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to save memory.",
      500,
    );
  }
}
