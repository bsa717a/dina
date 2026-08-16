import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireReadySession } from "@/lib/auth/session";
import { retrieveRelevantMemories } from "@/lib/memory/retrieve";
import { memoryScopeForUser } from "@/lib/memory/scope";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

const schema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().min(1).max(50).optional(),
  categories: z.array(z.string()).optional(),
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
  const parsed = schema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid retrieve request.");

  const memories = await retrieveRelevantMemories(parsed.data.query, {
    limit: parsed.data.limit,
    categories: parsed.data.categories,
    scope: await memoryScopeForUser(user),
  });
  return NextResponse.json({ memories, count: memories.length });
}
