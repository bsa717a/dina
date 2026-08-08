import { githubRequest, GitHubAccountError } from "@/lib/github/client";
import {
  dedupeActivityEvents,
  eventId,
  sortActivityEvents,
  toRepoRef,
} from "@/lib/github/identity";
import { listAccountRepositories } from "@/lib/github/repos";
import type {
  GitHubAccountConfig,
  GitHubAccountHealth,
  GitHubActivityEvent,
} from "@/lib/github/types";
import { logger } from "@/lib/logger";

type GhIssue = {
  id: number;
  number: number;
  title?: string;
  html_url?: string;
  user?: { login?: string };
  updated_at?: string;
  pull_request?: unknown;
  state?: string;
};

type GhPull = {
  id: number;
  number: number;
  title?: string;
  html_url?: string;
  user?: { login?: string };
  updated_at?: string;
  draft?: boolean;
  state?: string;
};

type GhCommit = {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
  };
  author?: { login?: string };
};

type GhWorkflowRun = {
  id: number;
  name?: string;
  html_url?: string;
  status?: string;
  conclusion?: string | null;
  updated_at?: string;
  head_branch?: string;
  actor?: { login?: string };
};

async function collectRepoEvents(
  account: GitHubAccountConfig,
  fullName: string,
): Promise<GitHubActivityEvent[]> {
  const ref = toRepoRef({
    accountId: account.id,
    accountLabel: account.label,
    fullName,
  });
  const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
  const events: GitHubActivityEvent[] = [];

  const soft = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await promise;
    } catch (error) {
      // Auth failures must surface so the account can be marked unhealthy.
      if (
        error instanceof GitHubAccountError &&
        (error.status === 401 || error.status === 403)
      ) {
        throw error;
      }
      return fallback;
    }
  };

  const [pulls, issues, commits, workflows] = await Promise.all([
    soft(
      githubRequest<GhPull[]>(
        account,
        `${base}/pulls?state=open&sort=updated&direction=desc&per_page=10`,
      ),
      [] as GhPull[],
    ),
    soft(
      githubRequest<GhIssue[]>(
        account,
        `${base}/issues?state=open&sort=updated&direction=desc&per_page=10`,
      ),
      [] as GhIssue[],
    ),
    soft(
      githubRequest<GhCommit[]>(account, `${base}/commits?per_page=8`),
      [] as GhCommit[],
    ),
    soft(
      githubRequest<{ workflow_runs?: GhWorkflowRun[] }>(
        account,
        `${base}/actions/runs?per_page=8`,
      ),
      { workflow_runs: [] as GhWorkflowRun[] },
    ),
  ]);

  for (const pull of pulls) {
    const nativeId = String(pull.id);
    events.push({
      accountId: account.id,
      accountLabel: account.label,
      kind: "pull_request",
      nativeId,
      eventId: eventId(account.id, "pull_request", nativeId),
      repoFullName: ref.fullName,
      repoKey: ref.key,
      title: pull.title || `PR #${pull.number}`,
      summary: `Open PR #${pull.number}${pull.draft ? " (draft)" : ""} in ${ref.fullName}`,
      url: pull.html_url,
      author: pull.user?.login,
      occurredAt: pull.updated_at,
      raw: { number: pull.number, state: pull.state, draft: pull.draft },
    });
  }

  for (const issue of issues) {
    if (issue.pull_request) continue;
    const nativeId = String(issue.id);
    events.push({
      accountId: account.id,
      accountLabel: account.label,
      kind: "issue",
      nativeId,
      eventId: eventId(account.id, "issue", nativeId),
      repoFullName: ref.fullName,
      repoKey: ref.key,
      title: issue.title || `Issue #${issue.number}`,
      summary: `Open issue #${issue.number} in ${ref.fullName}`,
      url: issue.html_url,
      author: issue.user?.login,
      occurredAt: issue.updated_at,
      raw: { number: issue.number, state: issue.state },
    });
  }

  for (const commit of commits) {
    const nativeId = commit.sha;
    const message = (commit.commit?.message || "").split("\n")[0] || nativeId.slice(0, 7);
    events.push({
      accountId: account.id,
      accountLabel: account.label,
      kind: "commit",
      nativeId,
      eventId: eventId(account.id, "commit", nativeId),
      repoFullName: ref.fullName,
      repoKey: ref.key,
      title: message,
      summary: `Commit ${nativeId.slice(0, 7)} in ${ref.fullName}`,
      url: commit.html_url,
      author: commit.author?.login || commit.commit?.author?.name,
      occurredAt: commit.commit?.author?.date,
      raw: { sha: commit.sha },
    });
  }

  for (const run of workflows.workflow_runs || []) {
    const nativeId = String(run.id);
    events.push({
      accountId: account.id,
      accountLabel: account.label,
      kind: "workflow_run",
      nativeId,
      eventId: eventId(account.id, "workflow_run", nativeId),
      repoFullName: ref.fullName,
      repoKey: ref.key,
      title: run.name || `Workflow ${nativeId}`,
      summary: `Workflow ${run.name || nativeId}: ${run.status}${
        run.conclusion ? `/${run.conclusion}` : ""
      } on ${ref.fullName}`,
      url: run.html_url,
      author: run.actor?.login,
      occurredAt: run.updated_at,
      raw: {
        status: run.status,
        conclusion: run.conclusion,
        head_branch: run.head_branch,
      },
    });
  }

  return events;
}

export async function collectAccountActivity(
  account: GitHubAccountConfig,
): Promise<{ events: GitHubActivityEvent[]; health: GitHubAccountHealth }> {
  try {
    const repos = await listAccountRepositories(account);
    let authFailure: string | undefined;
    const batches = await Promise.all(
      repos.map(async (repo) => {
        try {
          return await collectRepoEvents(account, repo.fullName);
        } catch (error) {
          if (
            error instanceof GitHubAccountError &&
            (error.status === 401 || error.status === 403)
          ) {
            authFailure = error.message;
          }
          logger.warn("github_repo_activity_failed", {
            accountId: account.id,
            repo: repo.fullName,
            error: error instanceof Error ? error.message : "unknown",
          });
          return [] as GitHubActivityEvent[];
        }
      }),
    );

    if (authFailure) {
      return {
        events: [],
        health: {
          accountId: account.id,
          accountLabel: account.label,
          ok: false,
          authMode: account.authMode,
          error: authFailure,
          repositoryCount: repos.length,
        },
      };
    }

    return {
      events: dedupeActivityEvents(batches.flat()),
      health: {
        accountId: account.id,
        accountLabel: account.label,
        ok: true,
        authMode: account.authMode,
        repositoryCount: repos.length,
      },
    };
  } catch (error) {
    const message =
      error instanceof GitHubAccountError
        ? error.message
        : error instanceof Error
          ? error.message
          : "unknown";
    logger.warn("github_account_activity_failed", {
      accountId: account.id,
      error: message,
    });
    return {
      events: [],
      health: {
        accountId: account.id,
        accountLabel: account.label,
        ok: false,
        authMode: account.authMode,
        error: message,
      },
    };
  }
}

/**
 * Cross-account activity. One account failing never drops the others.
 * Events are deduped by account-scoped eventId.
 */
export async function collectAllGitHubActivity(
  accounts: GitHubAccountConfig[],
  options?: { accountId?: string },
): Promise<{
  events: GitHubActivityEvent[];
  health: GitHubAccountHealth[];
}> {
  const selected = options?.accountId
    ? accounts.filter((a) => a.id === options.accountId?.toLowerCase())
    : accounts;

  const results = await Promise.all(
    selected.map((account) => collectAccountActivity(account)),
  );

  const events = sortActivityEvents(
    dedupeActivityEvents(results.flatMap((r) => r.events)),
  );
  const health = results.map((r) => r.health);
  return { events, health };
}
