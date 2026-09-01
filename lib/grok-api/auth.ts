/**
 * Service token authentication for Grok Bot Dina API.
 *
 * Grok Bot Dina authenticates using a Bearer token in the Authorization header.
 * The token is compared against GROK_BOT_DINA_API_TOKEN env var.
 */

import { NextRequest } from "next/server";
import { getGrokBotDinaApiToken } from "@/lib/env";
import { unauthorized } from "@/lib/http";

export interface ServiceTokenResult {
  valid: boolean;
  reason?: "missing_config" | "missing_header" | "invalid_token";
}

export function verifyServiceToken(request: NextRequest): ServiceTokenResult {
  const configuredToken = getGrokBotDinaApiToken();
  if (!configuredToken) {
    return { valid: false, reason: "missing_config" };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return { valid: false, reason: "missing_header" };
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { valid: false, reason: "invalid_token" };
  }

  const providedToken = match[1].trim();
  if (!providedToken || providedToken !== configuredToken) {
    return { valid: false, reason: "invalid_token" };
  }

  return { valid: true };
}

export function requireServiceToken(
  request: NextRequest,
): { ok: true } | { ok: false; response: Response } {
  const result = verifyServiceToken(request);
  if (!result.valid) {
    const message =
      result.reason === "missing_config"
        ? "Service not configured"
        : "Invalid or missing service token";
    return { ok: false, response: unauthorized(message) };
  }
  return { ok: true };
}

export function isGrokApiConfigured(): boolean {
  return Boolean(getGrokBotDinaApiToken());
}
