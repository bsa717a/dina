import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { upsertPushSubscription, deletePushSubscriptionByEndpoint } from "@/lib/db/push";
import { getVapidConfig } from "@/lib/env";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function GET() {
  if (!(await requireSession())) return unauthorized();
  const config = getVapidConfig();
  if (!config) return jsonError("Push is not configured.", 503);
  return NextResponse.json({ publicKey: config.publicKey });
}

export async function POST(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();
  if (!getVapidConfig()) return jsonError("Push is not configured.", 503);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = subscribeSchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid subscription.");

  await upsertPushSubscription({
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const endpoint = z.object({ endpoint: z.string().url() }).safeParse(json);
  if (!endpoint.success) return jsonError("endpoint is required.");

  await deletePushSubscriptionByEndpoint(endpoint.data.endpoint);
  return NextResponse.json({ ok: true });
}
