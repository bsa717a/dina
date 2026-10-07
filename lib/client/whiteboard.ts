export type WhiteboardViewer = {
  id?: string | null;
  name?: string | null;
  username?: string | null;
};

export type WhiteboardScope = "all" | "mine";

/** Prefer the signed-in user's display name. Fall back to their username. */
export function whiteboardOwnerName(user: WhiteboardViewer | null | undefined): string {
  const name = user?.name?.trim() ?? "";
  if (name) return name;
  return user?.username?.trim() ?? "";
}

export function whiteboardScopeStorageKey(userId: string): string {
  return `dina.whiteboardScope.${userId}`;
}

export function parseWhiteboardScope(value: string | null | undefined): WhiteboardScope {
  return value === "mine" ? "mine" : "all";
}

/** Owner written into a title, e.g. "Survey Lost Deals (owner: Adam, due 10/9/2026)". */
export function taskOwnerLabel(title: string): string | null {
  const match = title.match(/\bowner:\s*([^,)\n]+)/i);
  const label = match?.[1]?.trim().replace(/[.\s]+$/g, "") ?? "";
  return label || null;
}

function normalizePerson(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Whole name, or a single token against the other name's first word. */
function samePerson(label: string, candidate: string): boolean {
  const left = normalizePerson(label);
  const right = normalizePerson(candidate);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftFirst = left.split(" ")[0] ?? "";
  const rightFirst = right.split(" ")[0] ?? "";
  if (!left.includes(" ") && left === rightFirst) return true;
  if (!right.includes(" ") && right === leftFirst) return true;
  return false;
}

function usernameAsName(username: string): string {
  return normalizePerson(username).replace(/[_./-]+/g, " ");
}

/**
 * Mine when the task's assignee is the signed-in user.
 * If there is no assignee, match "owner: …" in the title to the display name or username.
 */
export function taskOwnedByViewer(
  task: { title: string; assigneeUserId?: string | null },
  viewer: WhiteboardViewer | null | undefined,
): boolean {
  if (!viewer) return false;
  const assigneeId = task.assigneeUserId?.trim() ?? "";
  if (assigneeId) return assigneeId === (viewer.id?.trim() ?? "");
  const label = taskOwnerLabel(task.title);
  if (!label) return false;
  const name = viewer.name?.trim() ?? "";
  const username = viewer.username?.trim() ?? "";
  if (name && samePerson(label, name)) return true;
  if (!username) return false;
  return samePerson(label, username) || samePerson(label, usernameAsName(username));
}

export function whiteboardHeading(ownerName: string | null | undefined): string {
  const name = ownerName?.trim() ?? "";
  if (!name) return "Whiteboard";
  return `${name}'s Whiteboard`;
}
