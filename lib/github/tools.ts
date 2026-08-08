import { collectAllGitHubActivity } from "@/lib/github/activity";
import {
  getGitHubAccount,
  getGitHubAccounts,
  isGitHubConfigured,
  listGitHubAccountSummaries,
} from "@/lib/github/config";
import { listGitHubProjects } from "@/lib/github/projects";
import { findAccountsOwningRepo, listAccountRepositories } from "@/lib/github/repos";
import { logger } from "@/lib/logger";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "GitHub tool failed";
  return JSON.stringify({ ok: false, error: message });
}

async function listAccounts() {
  return ok({ accounts: listGitHubAccountSummaries() });
}

async function listRepositories(args: { accountId?: string }) {
  const accounts = args.accountId
    ? [getGitHubAccount(args.accountId)].filter(Boolean)
    : getGitHubAccounts();
  if (!accounts.length) {
    return fail(new Error("No matching GitHub accounts configured."));
  }

  const repositories = [];
  for (const account of accounts) {
    if (!account) continue;
    const repos = await listAccountRepositories(account);
    repositories.push(
      ...repos.map((repo) => ({
        accountId: repo.accountId,
        accountLabel: repo.accountLabel,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        key: repo.key,
      })),
    );
  }
  return ok({ repositories });
}

async function githubActivity(args: {
  accountId?: string;
  kind?: string;
  limit?: number;
}) {
  const accounts = getGitHubAccounts();
  if (!accounts.length) return fail(new Error("GitHub is not configured."));

  const { events, health } = await collectAllGitHubActivity(accounts, {
    accountId: args.accountId,
  });

  let filtered = events;
  if (args.kind) {
    filtered = filtered.filter((e) => e.kind === args.kind);
  }
  const limit = Math.min(Math.max(args.limit ?? 40, 1), 100);
  return ok({
    health,
    events: filtered.slice(0, limit).map((event) => ({
      accountId: event.accountId,
      accountLabel: event.accountLabel,
      kind: event.kind,
      eventId: event.eventId,
      repoFullName: event.repoFullName,
      repoKey: event.repoKey,
      title: event.title,
      summary: event.summary,
      url: event.url,
      author: event.author,
      occurredAt: event.occurredAt,
    })),
  });
}

async function whichAccountOwnsRepo(args: { query: string }) {
  const matches = await findAccountsOwningRepo(getGitHubAccounts(), args.query);
  return ok({
    query: args.query,
    matches,
    note:
      matches.length > 1
        ? "Same repository name may exist under different accounts/owners; use accountId + fullName."
        : undefined,
  });
}

async function listProjects(args: {
  accountId?: string;
  includeReadme?: boolean;
}) {
  const accounts = getGitHubAccounts();
  if (!accounts.length) return fail(new Error("GitHub is not configured."));

  const { projects, errors } = await listGitHubProjects(accounts, {
    accountId: args.accountId,
    includeReadme: args.includeReadme !== false,
  });

  return ok({
    projectCount: projects.length,
    projects,
    errors: errors.length ? errors : undefined,
    note: "Each project includes accountId so personal and 4StudentLives repos never mix.",
  });
}

const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  list_github_accounts: () => listAccounts(),
  list_github_repositories: (args) =>
    listRepositories(args as { accountId?: string }),
  list_github_projects: (args) =>
    listProjects(
      args as { accountId?: string; includeReadme?: boolean },
    ),
  github_activity: (args) =>
    githubActivity(
      args as { accountId?: string; kind?: string; limit?: number },
    ),
  which_github_account_owns_repo: (args) =>
    whichAccountOwnsRepo(args as { query: string }),
};

export function listGitHubToolNames() {
  return Object.keys(handlers);
}

export async function executeGitHubTool(
  name: string,
  argsJson: string,
): Promise<string> {
  if (!isGitHubConfigured()) {
    return fail(new Error("GitHub is not configured."));
  }
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown GitHub tool: ${name}`));

  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }

  try {
    return await handler(args);
  } catch (error) {
    logger.error("github_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail(error);
  }
}
