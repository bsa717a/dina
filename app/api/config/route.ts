import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getVapidConfig } from "@/lib/env";
import { unauthorized } from "@/lib/http";
import { getMicrosoftConfig, isMicrosoftConfigured } from "@/lib/microsoft/config";
import { listMicrosoftToolNames } from "@/lib/microsoft/tools";

export const runtime = "nodejs";

/** Non-secret client config for authenticated sessions. */
export async function GET() {
  if (!(await requireSession())) return unauthorized();
  const vapid = getVapidConfig();
  const ms = getMicrosoftConfig();
  return NextResponse.json({
    pushEnabled: Boolean(vapid),
    vapidPublicKey: vapid?.publicKey ?? null,
    microsoftEnabled: isMicrosoftConfigured(),
    microsoftUser: ms?.userEmail ?? null,
    microsoftTools: isMicrosoftConfigured() ? listMicrosoftToolNames() : [],
  });
}
