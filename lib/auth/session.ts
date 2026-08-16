import { getIronSession, SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { cookieSecureForRequest } from "@/lib/auth/cookie-secure";
import { getSessionSecret } from "@/lib/env";

export type SessionData = {
  authenticated?: boolean;
  createdAt?: number;
};

export async function getSessionOptions(request?: {
  headers: { get(name: string): string | null };
  url?: string;
}): Promise<SessionOptions> {
  const headerStore = request?.headers ?? (await headers());
  return {
    cookieName: "dina_session",
    password: getSessionSecret(),
    cookieOptions: {
      httpOnly: true,
      secure: cookieSecureForRequest({
        forwardedProto: headerStore.get("x-forwarded-proto"),
        url: request?.url,
      }),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession(request?: {
  headers: { get(name: string): string | null };
  url?: string;
}) {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(
    cookieStore,
    await getSessionOptions(request),
  );
}

export async function requireSession() {
  const session = await getSession();
  if (!session.authenticated) {
    return null;
  }
  return session;
}
