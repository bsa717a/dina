import { getMicrosoftConfig } from "@/lib/microsoft/config";
import { logger } from "@/lib/logger";

type TokenCache = {
  token: string | null;
  expiresAt: number;
};

const tokenCache: TokenCache = {
  token: null,
  expiresAt: 0,
};

export class GraphError extends Error {
  status: number;
  details: string;

  constructor(message: string, status: number, details: string) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.details = details;
  }
}

export async function getGraphToken(): Promise<string> {
  const config = getMicrosoftConfig();
  if (!config) {
    throw new Error(
      "Microsoft 365 is not configured. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, and MS_USER_EMAIL.",
    );
  }

  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(tokenUrl, {
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
    logger.error("graph_token_failed", {
      status: response.status,
      error: payload.error,
    });
    throw new Error(
      payload.error_description ||
        payload.error ||
        "Failed to obtain Microsoft Graph access token.",
    );
  }

  tokenCache.token = payload.access_token;
  tokenCache.expiresAt = Date.now() + ((payload.expires_in ?? 3600) - 60) * 1000;
  return payload.access_token;
}

export function userPath(suffix = ""): string {
  const config = getMicrosoftConfig();
  if (!config) throw new Error("Microsoft 365 is not configured.");
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.userEmail)}`;
  if (!suffix) return base;
  return `${base}${suffix.startsWith("/") ? "" : "/"}${suffix}`;
}

export async function graphRequest<T = unknown>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    rawBody?: BodyInit | null;
    contentType?: string | null;
  } = {},
): Promise<T> {
  const token = await getGraphToken();
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

  if (response.status === 204) {
    return { status: "success", code: 204 } as T;
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data &&
      "error" in data &&
      typeof (data as { error?: { message?: string } }).error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : `Graph request failed (${response.status})`;
    throw new GraphError(message, response.status, text.slice(0, 800));
  }

  return data as T;
}

export async function checkMicrosoftGraph(): Promise<{
  ok: boolean;
  configured: boolean;
  error?: string;
}> {
  if (!getMicrosoftConfig()) {
    return { ok: false, configured: false, error: "missing_config" };
  }
  try {
    await getGraphToken();
    await graphRequest(`${userPath()}?$select=id,displayName,mail`);
    return { ok: true, configured: true };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : "graph_unavailable",
    };
  }
}

/** Reset token cache (tests). */
export function clearGraphTokenCache() {
  tokenCache.token = null;
  tokenCache.expiresAt = 0;
}
