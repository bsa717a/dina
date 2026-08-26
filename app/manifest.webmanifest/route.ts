import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { withSecurityHeaders } from "@/lib/http";
import {
  resolvePwaIdentity,
  webAppManifest,
} from "@/lib/pwa/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Install name + icons follow the signed-in assistant, not a hardcoded Dina. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  let sessionKey: string | null = null;
  try {
    const user = await requireSession();
    sessionKey = user?.assistantKey ?? null;
  } catch {
    sessionKey = null;
  }

  const identity = resolvePwaIdentity({
    assistantKey: url.searchParams.get("assistant"),
    fallbackKey: sessionKey,
  });

  return withSecurityHeaders(
    NextResponse.json(webAppManifest(identity), {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "private, no-store",
      },
    }),
  );
}
