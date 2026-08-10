import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  formatUsageCompact,
  getTodayUsageTotals,
} from "@/lib/ai/usage";
import { unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  if (!(await requireSession())) return unauthorized();

  const totals = getTodayUsageTotals();
  return NextResponse.json({
    ok: true,
    totals,
    label: formatUsageCompact(totals),
    timezone: "America/Denver",
  });
}
