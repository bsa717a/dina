import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { retrieveRelevantMemories } from "@/lib/memory/retrieve";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

const schema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().min(1).max(50).optional(),
  categories: z.array(z.string()).optional(),
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
  if (!parsed.success) return jsonError("Invalid retrieve request.");

  const memories = await retrieveRelevantMemories(parsed.data.query, {
    limit: parsed.data.limit,
    categories: parsed.data.categories,
  });
  return NextResponse.json({ memories, count: memories.length });
}
