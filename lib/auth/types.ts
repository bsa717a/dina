export const USER_ROLES = ["owner", "member"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  assistantName: string;
  assistantPersona: string;
  assistantKey: string | null;
  mustChangePassword: boolean;
  phoneNumber: string | null;
};

export function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value as UserRole);
}

export function toAuthUser(row: {
  id: string;
  name: string;
  username: string;
  role: string;
  assistantName: string;
  assistantPersona: string;
  assistantKey?: string | null;
  mustChangePassword?: boolean;
  phoneNumber?: string | null;
}): AuthUser {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: isUserRole(row.role) ? row.role : "member",
    assistantName: row.assistantName,
    assistantPersona: row.assistantPersona,
    assistantKey: row.assistantKey ?? null,
    mustChangePassword: Boolean(row.mustChangePassword),
    phoneNumber: row.phoneNumber ?? null,
  };
}

export function needsOnboarding(user: AuthUser): boolean {
  return user.role === "member" && (user.mustChangePassword || !user.assistantKey);
}
