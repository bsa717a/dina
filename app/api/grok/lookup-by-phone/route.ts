/**
 * GET /api/grok/lookup-by-phone?phone=+14352382071
 *
 * Look up a teammate by phone number (E.164 format).
 * Requires service token authentication.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireServiceToken } from "@/lib/grok-api/auth";
import { reachUserResponse, visibleProjectKeys } from "@/lib/grok-api/scope";
import { lookupByPhoneNumber } from "@/lib/telnyx/roster";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireServiceToken(request);
  if (!auth.ok) return auth.response;

  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) {
    return jsonError("Missing required query parameter: phone", 400);
  }

  const result = await lookupByPhoneNumber(phone);

  if (!result.found) {
    return NextResponse.json({
      ok: true,
      found: false,
      phoneNumber: result.phoneNumber,
      reason: result.reason,
    });
  }

  const denied = await reachUserResponse(auth.actor, result.user.id);
  if (denied) return denied;

  return NextResponse.json({
    ok: true,
    found: true,
    user: {
      id: result.user.id,
      name: result.user.name,
      username: result.user.username,
      phoneNumber: result.user.phoneNumber,
    },
    projectKeys: await visibleProjectKeys(auth.actor, result.projectKeys),
  });
}
