import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/auth/session";
import { SECURITY_HEADERS } from "@/lib/http";

const PUBLIC_PATHS = new Set([
  "/login",
  "/offline",
  "/api/health",
  "/api/auth/login",
  "/manifest.webmanifest",
  "/sw.js",
]);

function isPublic(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/icons/")) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
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

  const appUrl = process.env.APP_URL || "";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const secure =
    appUrl.startsWith("https://") ||
    forwardedProto === "https" ||
    process.env.NODE_ENV === "production";

  const session = await getIronSession<SessionData>(request, response, {
    cookieName: "dina_session",
    password,
    cookieOptions: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    },
  });

  if (!session.authenticated) {
    if (pathname.startsWith("/api/")) {
      return applyHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const loginUrl = new URL("/login", request.url);
    return applyHeaders(NextResponse.redirect(loginUrl));
  }

  return applyHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
