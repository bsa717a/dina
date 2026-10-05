import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { forgotPasswordMessage, requestPasswordReset } from "@/lib/auth/password-reset";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";

const bodySchema = z.object({
  username: z.string().trim().min(1).max(200),
});

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Enter your username.");
  }

  await requestPasswordReset(parsed.data.username);
  return NextResponse.json({ ok: true, message: forgotPasswordMessage() });
}
