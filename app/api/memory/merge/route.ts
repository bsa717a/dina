import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { mergeMemories } from "@/lib/memory/store";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

const schema = z.object({
  survivorId: z.string().min(1),
  mergeIds: z.array(z.string()).min(1),
  title: z.string().optional(),
  content: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export async function POST(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid merge request.");

  try {
    const memory = await mergeMemories(parsed.data);
    return NextResponse.json({ memory });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Merge failed.",
      400,
    );
  }
}
