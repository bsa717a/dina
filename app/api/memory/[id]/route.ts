import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  approveMemory,
  archiveMemory,
  getMemory,
  updateMemory,
} from "@/lib/memory/store";
import { MEMORY_CATEGORIES, MEMORY_IMPORTANCE } from "@/lib/memory/types";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await context.params;
  const memory = await getMemory(id);
  if (!memory) return jsonError("Memory not found.", 404);
  return NextResponse.json({ memory });
}

const patchSchema = z.object({
  action: z.enum(["update", "archive", "approve"]).default("update"),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  title: z.string().min(1).max(300).optional(),
  content: z.string().min(1).max(20_000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  importance: z.enum(MEMORY_IMPORTANCE).optional(),
  relatedIds: z.array(z.string()).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await requireSession())) return unauthorized();
  const { id } = await context.params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid memory update.");

  try {
    if (parsed.data.action === "archive") {
      const memory = await archiveMemory(id);
      return NextResponse.json({ memory });
    }
    if (parsed.data.action === "approve") {
      const memory = await approveMemory(id);
      return NextResponse.json({ memory });
    }
    const memory = await updateMemory(id, parsed.data);
    return NextResponse.json({ memory });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to update memory.",
      404,
    );
  }
}
