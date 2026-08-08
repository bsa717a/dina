import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createOrCorrectMemory, listMemories } from "@/lib/memory/store";
import { MEMORY_CATEGORIES, MEMORY_IMPORTANCE } from "@/lib/memory/types";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  const category = request.nextUrl.searchParams.get("category") || undefined;
  const status = request.nextUrl.searchParams.get("status") || "active";
  const memories = await listMemories({ category, status, limit: 200 });
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
});

export async function POST(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid memory payload.");

  try {
    const memory = await createOrCorrectMemory(parsed.data);
    return NextResponse.json({ memory });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Failed to save memory.",
      500,
    );
  }
}
