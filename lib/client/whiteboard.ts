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

const DUE_PATTERN =
  /\bdue:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?)/i;

const META_PARENS = /\s*\((?=[^)]*\b(?:owner|due)\b)[^)]*\)/gi;

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Due written into a title or description, e.g. "due 10/9/2026". */
export function taskDueLabel(title: string, description = ""): string | null {
  const match = `${title}\n${description}`.match(DUE_PATTERN);
  const label = match?.[1]?.trim() ?? "";
  return label || null;
}

function calendarIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse a due label or YYYY-MM-DD into a calendar date. Invalid dates are null. */
export function dueLabelToIso(label: string | null | undefined): string | null {
  const text = label?.trim() ?? "";
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return calendarIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    return calendarIso(year, Number(slash[1]), Number(slash[2]));
  }
  const named =
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/i.exec(
      text,
    );
  if (!named) return null;
  const month = MONTH_INDEX[named[1].slice(0, 3).toLowerCase()] ?? 0;
  const year = named[3] ? Number(named[3]) : new Date().getUTCFullYear();
  return calendarIso(year, month, Number(named[2]));
}

/** Date input value, or null when the task has no due date. */
export function formatDueOn(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return calendarIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Title parenthetical, matching existing board titles: "due 10/9/2026". */
export function isoToDueLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

export function parseDueOn(value: string | null): Date | null {
  if (value === null) return null;
  const iso = dueLabelToIso(value);
  if (!iso) throw new Error("Due date must be a real calendar day (YYYY-MM-DD).");
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function keptLabel(value: string | null | undefined): string | null {
  const label = value?.trim() ?? "";
  return label || null;
}

/**
 * Keep the task title in sync with owner and due.
 * Omit a key to leave that part of the title alone. Null clears it.
 */
export function rewriteTaskTitle(
  title: string,
  patch: { owner?: string | null; due?: string | null },
): string {
  const stripped = title.replace(META_PARENS, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return title.trim();
  const owner =
    patch.owner === undefined ? taskOwnerLabel(title) : keptLabel(patch.owner);
  const due = patch.due === undefined ? taskDueLabel(title) : keptLabel(patch.due);
  const bits: string[] = [];
  if (owner) bits.push(`owner: ${owner}`);
  if (due) bits.push(`due ${due}`);
  if (!bits.length) return stripped;
  return `${stripped} (${bits.join(", ")})`;
}
