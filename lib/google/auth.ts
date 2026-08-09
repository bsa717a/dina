import { getGoogleConfig } from "@/lib/google/config";
import { logger } from "@/lib/logger";

type TokenCache = {
  token: string | null;
  expiresAt: number;
};

const tokenCache: TokenCache = {
  token: null,
  expiresAt: 0,
};

export class GoogleApiError extends Error {
  status: number;
  details: string;

  constructor(message: string, status: number, details: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.details = details;
  }
}

function clearGoogleTokenCache() {
  tokenCache.token = null;
  tokenCache.expiresAt = 0;
}

export async function getGoogleAccessToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const config = getGoogleConfig();
  if (!config) {
    throw new Error(
      "Google is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, and GOOGLE_USER_EMAIL.",
    );
  }

  if (
    !options.forceRefresh &&
    tokenCache.token &&
    Date.now() < tokenCache.expiresAt
  ) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    clearGoogleTokenCache();
    logger.error("google_token_failed", {
      status: response.status,
      error: payload.error,
    });
    throw new Error(
      payload.error_description ||
        payload.error ||
        "Failed to obtain Google access token.",
    );
  }

  tokenCache.token = payload.access_token;
  tokenCache.expiresAt = Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000;
  return payload.access_token;
}

async function performGoogleRequest(
  url: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: BodyInit | null;
    contentType?: string | null;
  },
): Promise<{ response: Response; parsed: unknown; text: string }> {
  const method = options.method || "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody ?? undefined;
    if (options.contentType) headers["Content-Type"] = options.contentType;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = options.contentType || "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { response, parsed, text };
}

export async function googleRequest<T = unknown>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: BodyInit | null;
    contentType?: string | null;
  } = {},
): Promise<T> {
  let token = await getGoogleAccessToken();
  let { response, parsed, text } = await performGoogleRequest(url, token, options);

  // Access token revoked/expired early — clear cache and retry once.
  if (response.status === 401) {
    clearGoogleTokenCache();
    token = await getGoogleAccessToken({ forceRefresh: true });
    ({ response, parsed, text } = await performGoogleRequest(url, token, options));
  }

  if (!response.ok) {
    const details =
      typeof parsed === "object" && parsed
        ? JSON.stringify(parsed).slice(0, 800)
        : String(text).slice(0, 800);
    throw new GoogleApiError(
      `Google API ${options.method || "GET"} failed (${response.status})`,
      response.status,
      details,
    );
  }

  return parsed as T;
}

export async function checkGoogleApis(): Promise<{
  configured: boolean;
  ok: boolean;
  email?: string;
  error?: string;
}> {
  const config = getGoogleConfig();
  if (!config) return { configured: false, ok: false };

  try {
    const profile = await googleRequest<{ emailAddress?: string }>(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
    const actual = (profile.emailAddress || "").trim().toLowerCase();
    const expected = config.userEmail.trim().toLowerCase();
    if (actual && expected && actual !== expected) {
      return {
        configured: true,
        ok: false,
        email: actual,
        error: `Authenticated Google account (${actual}) does not match GOOGLE_USER_EMAIL (${expected}).`,
      };
    }
    return {
      configured: true,
      ok: true,
      email: actual || config.userEmail,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      error: error instanceof Error ? error.message : "unavailable",
    };
  }
}
