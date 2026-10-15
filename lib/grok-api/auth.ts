/**
 * Service token authentication for the Grok API.
 *
 * A per-user token (SHA-256 stored on User.grokApiTokenHash) acts as that user.
 * GROK_BOT_DINA_API_TOKEN remains the full-access Dina service.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth/types";
import { findUserByGrokApiToken } from "@/lib/grok-api/bots";
import { getGrokBotDinaApiToken } from "@/lib/env";
import { unauthorized } from "@/lib/http";

export type ServiceActor =
  | { kind: "service" }
  | { kind: "user"; user: AuthUser };

export type ServiceTokenResult =
  | { valid: true; actor: ServiceActor; reason?: undefined }
  | {
      valid: false;
      reason: "missing_config" | "missing_header" | "invalid_token";
    };

function tokensMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function readBearer(
  request: NextRequest,
): { token: string } | { reason: "missing_header" | "invalid_token" } {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { reason: "missing_header" };
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { reason: "invalid_token" };
  const token = match[1].trim();
  if (!token) return { reason: "invalid_token" };
  return { token };
}

export async function verifyServiceToken(
  request: NextRequest,
): Promise<ServiceTokenResult> {
  const configuredToken = getGrokBotDinaApiToken();
  const bearer = readBearer(request);

  if ("reason" in bearer) {
    if (!configuredToken) return { valid: false, reason: "missing_config" };
    return { valid: false, reason: bearer.reason };
  }

  if (configuredToken && tokensMatch(bearer.token, configuredToken)) {
    return { valid: true, actor: { kind: "service" } };
  }

  const user = await findUserByGrokApiToken(bearer.token);
  if (user) return { valid: true, actor: { kind: "user", user } };

  if (!configuredToken) return { valid: false, reason: "missing_config" };
  return { valid: false, reason: "invalid_token" };
}

export async function requireServiceToken(
  request: NextRequest,
): Promise<
  { ok: true; actor: ServiceActor } | { ok: false; response: Response }
> {
  const result = await verifyServiceToken(request);
  if (!result.valid) {
    const message =
      result.reason === "missing_config"
        ? "Service not configured"
        : "Invalid or missing service token";
    return { ok: false, response: unauthorized(message) };
  }
  return { ok: true, actor: result.actor };
}

export function isGrokApiConfigured(): boolean {
  return Boolean(getGrokBotDinaApiToken());
}
