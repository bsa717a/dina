/**
 * Session cookie Secure flag must match the request that set it.
 * NODE_ENV=production is not HTTPS — Safari drops Secure cookies on
 * http://localhost, so login appears to succeed then bounces back to /login.
 */
export function cookieSecureForRequest(input: {
  forwardedProto?: string | null;
  url?: string | null;
}): boolean {
  const forwarded = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  if (input.url) {
    try {
      return new URL(input.url).protocol === "https:";
    } catch {
      return input.url.startsWith("https://");
    }
  }
  return false;
}
