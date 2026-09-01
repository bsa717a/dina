import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookieSecureForRequest } from "@/lib/auth/cookie-secure";
import type { SessionData } from "@/lib/auth/session";
import { SECURITY_HEADERS } from "@/lib/http";

const PUBLIC_PATHS = new Set([
  "/login",
  "/offline",
  "/api/health",
  "/api/auth/login",
  "/api/telnyx/webhook",
  "/manifest.webmanifest",
  "/sw.js",
  "/file-drop-guard.js",
  "/pwa-install-capture.js",
]);

const ONBOARDING_PATHS = new Set([
  "/onboarding",
  "/api/auth/onboard",
  "/api/assistants",
  "/api/auth/logout",
  "/api/config",
]);

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/api/grok/")) return true;
  if (pathname.startsWith("/icons/")) return true;
  if (pathname.startsWith("/assistants/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/dina-avatar.jpg" || pathname.startsWith("/dina-")) return true;
  return false;
}

function applyHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return applyHeaders(NextResponse.next());
  }

  if (pathname === "/api/attention/scan" && request.method === "POST") {
    const secret = process.env.ATTENTION_SCAN_SECRET?.trim();
    const provided = request.headers.get("x-attention-secret")?.trim();
    if (secret && provided && secret === provided) {
      return applyHeaders(NextResponse.next());
    }
  }

  const response = NextResponse.next();
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    if (pathname.startsWith("/api/")) {
      return applyHeaders(
        NextResponse.json(
          { error: "Server is misconfigured (SESSION_SECRET)." },
          { status: 500 },
        ),
      );
    }
    return applyHeaders(NextResponse.redirect(new URL("/login", request.url)));
  }

  const session = await getIronSession<SessionData>(request, response, {
    cookieName: "dina_session",
    password,
    cookieOptions: {
      httpOnly: true,
      secure: cookieSecureForRequest({
        forwardedProto: request.headers.get("x-forwarded-proto"),
        url: request.url,
      }),
      sameSite: "lax",
      path: "/",
    },
  });

  if (!session.authenticated || !session.userId) {
    if (pathname.startsWith("/api/")) {
      return applyHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    return applyHeaders(NextResponse.redirect(new URL("/login", request.url)));
  }

  if (session.needsOnboarding && !ONBOARDING_PATHS.has(pathname)) {
    if (pathname.startsWith("/api/")) {
      return applyHeaders(
        NextResponse.json({ error: "Onboarding required." }, { status: 403 }),
      );
    }
    return applyHeaders(NextResponse.redirect(new URL("/onboarding", request.url)));
  }

  if (!session.needsOnboarding && pathname === "/onboarding") {
    return applyHeaders(NextResponse.redirect(new URL("/", request.url)));
  }

  return applyHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
