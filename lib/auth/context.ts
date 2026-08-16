import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "@/lib/auth/types";

const store = new AsyncLocalStorage<AuthUser>();

export function runWithAuthUser<T>(user: AuthUser, fn: () => T): T {
  return store.run(user, fn);
}

export function getRequestUser(): AuthUser | null {
  return store.getStore() ?? null;
}
