import { getIronSession, SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { cookieSecureForRequest } from "@/lib/auth/cookie-secure";
import { getUserById, needsOnboarding } from "@/lib/auth/users";
import type { AuthUser, UserRole } from "@/lib/auth/types";
import { forbidden, unauthorized } from "@/lib/http";
import { getSessionSecret } from "@/lib/env";

export type SessionData = {
  authenticated?: boolean;
  userId?: string;
  role?: UserRole;
  needsOnboarding?: boolean;
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

export async function requireSession(): Promise<AuthUser | null> {
  const session = await getSession();
  if (!session.authenticated || !session.userId) {
    return null;
  }
  return getUserById(session.userId);
}

export async function requireOwner(): Promise<AuthUser | null> {
  const user = await requireSession();
  if (!user || user.role !== "owner") return null;
  return user;
}

export async function requireReadySession(): Promise<
  { ok: true; user: AuthUser } | { ok: false; response: Response }
> {
  const user = await requireSession();
  if (!user) return { ok: false, response: unauthorized() };
  if (needsOnboarding(user)) {
    return { ok: false, response: forbidden("Onboarding required.") };
  }
  return { ok: true, user };
}
