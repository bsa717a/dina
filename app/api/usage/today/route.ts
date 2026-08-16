import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  formatUsageCompact,
  getTodayUsageTotals,
} from "@/lib/ai/usage";
import { forbidden, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (user.role !== "owner") return forbidden();

  const totals = getTodayUsageTotals();
  return NextResponse.json({
    ok: true,
    totals,
    label: formatUsageCompact(totals),
    timezone: "America/Denver",
  });
}
