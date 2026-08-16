import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { runChiefOfStaffScan } from "@/lib/chief-of-staff/engine";
import { getAttentionScanSecret } from "@/lib/env";
import { forbidden, jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(request: NextRequest, sessionOk: boolean) {
  if (sessionOk) return true;
  const secret = getAttentionScanSecret();
  const provided = request.headers.get("x-attention-secret")?.trim();
  return Boolean(secret && provided && secret === provided);
}

export async function POST(request: NextRequest) {
  const user = await requireSession();
  if (user && user.role !== "owner") return forbidden();
  if (!authorized(request, Boolean(user))) return unauthorized();

  try {
    const result = await runChiefOfStaffScan({ sendPush: true });
    return NextResponse.json({
      ok: true,
      engine: result.engine,
      runId: result.runId,
      seen: result.seen,
      decisions: result.decisions,
      open: result.open,
      notified: result.notified,
      dispositions: result.dispositions,
      connectorErrors: result.connectorErrors,
      skipped: "skipped" in result ? result.skipped : false,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Chief of Staff scan failed.",
      500,
    );
  }
}
