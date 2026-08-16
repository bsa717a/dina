import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MEMBER_ASSISTANT_KEYS } from "@/lib/assistants/catalog";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { getSession, requireSession } from "@/lib/auth/session";
import { completeOnboarding, needsOnboarding } from "@/lib/auth/users";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const bodySchema = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
  confirmPassword: z.string().min(1).max(256),
  assistantKey: z.enum(MEMBER_ASSISTANT_KEYS),
});

export async function POST(request: NextRequest) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (user.role !== "member") return forbidden();
  if (!needsOnboarding(user)) {
    const session = await getSession(request);
    session.needsOnboarding = false;
    session.role = user.role;
    await session.save();
    return NextResponse.json({
      ok: true,
      alreadyComplete: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        assistantName: user.assistantName,
        assistantKey: user.assistantKey,
      },
    });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return jsonError("Choose a personality and a password of at least 10 characters.");
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return jsonError("Passwords do not match.");
  }

  try {
    const updated = await completeOnboarding({
      userId: user.id,
      password: parsed.data.password,
      assistantKey: parsed.data.assistantKey,
    });
    const session = await getSession(request);
    session.needsOnboarding = false;
    session.role = updated.role;
    await session.save();
    logger.info("onboarding_complete", {
      userId: updated.id,
      assistantKey: updated.assistantKey,
    });
    return NextResponse.json({
      ok: true,
      user: {
        id: updated.id,
        name: updated.name,
        role: updated.role,
        assistantName: updated.assistantName,
        assistantKey: updated.assistantKey,
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Onboarding failed.",
      400,
    );
  }
}
