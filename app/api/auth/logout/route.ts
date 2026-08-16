import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  session.destroy();
  logger.info("logout");
  return NextResponse.json({ ok: true });
}
