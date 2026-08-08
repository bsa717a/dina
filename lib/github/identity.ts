import type { GitHubActivityEvent, GitHubEventKind, GitHubRepoRef } from "@/lib/github/types";

export function normalizeRepoFullName(fullName: string): string {
  const cleaned = fullName.trim().replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository full name: ${fullName}`);
  }
  return `${parts[0]}/${parts[1]}`;
}

export function repoKey(accountId: string, fullName: string): string {
  return `${accountId}:${normalizeRepoFullName(fullName).toLowerCase()}`;
}

export function toRepoRef(input: {
  accountId: string;
  accountLabel: string;
  fullName: string;
}): GitHubRepoRef {
  const fullName = normalizeRepoFullName(input.fullName);
  const [owner, name] = fullName.split("/");
  return {
    accountId: input.accountId,
    accountLabel: input.accountLabel,
    owner,
    name,
    fullName,
    key: repoKey(input.accountId, fullName),
  };
}

export function eventId(
  accountId: string,
  kind: GitHubEventKind,
  nativeId: string,
): string {
  return `${accountId}:${kind}:${nativeId}`;
}

export function dedupeActivityEvents(
  events: GitHubActivityEvent[],
): GitHubActivityEvent[] {
  const seen = new Set<string>();
  const out: GitHubActivityEvent[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    out.push(event);
  }
  return out;
}

/** Sort newest first for cross-account summaries. */
export function sortActivityEvents(
  events: GitHubActivityEvent[],
): GitHubActivityEvent[] {
  return [...events].sort((a, b) => {
    const at = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const bt = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return bt - at;
  });
}
