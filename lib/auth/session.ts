import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { getSessionSecret, isHttpsApp } from "@/lib/env";

export type SessionData = {
  authenticated?: boolean;
  createdAt?: number;
};

export function getSessionOptions(): SessionOptions {
  return {
    cookieName: "dina_session",
    password: getSessionSecret(),
    cookieOptions: {
      httpOnly: true,
      secure: isHttpsApp(),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

export async function requireSession() {
  const session = await getSession();
  if (!session.authenticated) {
    return null;
  }
  return session;
}
