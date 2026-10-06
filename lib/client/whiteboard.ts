/** Prefer the signed-in user's display name. Fall back to their username. */
export function whiteboardOwnerName(user: {
  name?: string | null;
  username?: string | null;
} | null | undefined): string {
  const name = user?.name?.trim() ?? "";
  if (name) return name;
  return user?.username?.trim() ?? "";
}

export function whiteboardHeading(ownerName: string | null | undefined): string {
  const name = ownerName?.trim() ?? "";
  if (!name) return "Whiteboard";
  return `${name}'s Whiteboard`;
}
