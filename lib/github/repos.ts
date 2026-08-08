import { githubRequest } from "@/lib/github/client";
import { toRepoRef } from "@/lib/github/identity";
import type { GitHubAccountConfig, GitHubRepoRef } from "@/lib/github/types";

type GhRepo = {
  full_name?: string;
  name?: string;
  owner?: { login?: string };
  private?: boolean;
  html_url?: string;
  description?: string | null;
};

async function paginateRepos(
  account: GitHubAccountConfig,
  path: string,
): Promise<GhRepo[]> {
  const repos: GhRepo[] = [];
  let page = 1;
  while (page <= 20) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await githubRequest<GhRepo[]>(
      account,
      `${path}${separator}per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos;
}

async function discoverRepositories(
  account: GitHubAccountConfig,
): Promise<GitHubRepoRef[]> {
  let raw: GhRepo[] = [];

  if (account.owner) {
    // Prefer org listing; fall back to user listing for personal owners.
    try {
      raw = await paginateRepos(
        account,
        `/orgs/${encodeURIComponent(account.owner)}/repos?type=all&sort=updated`,
      );
    } catch {
      raw = await paginateRepos(
        account,
        `/users/${encodeURIComponent(account.owner)}/repos?type=all&sort=updated`,
      );
    }
  } else {
    raw = await paginateRepos(
      account,
      "/user/repos?affiliation=owner,organization_member&sort=updated",
    );
  }

  const ownerFilter = account.owner?.toLowerCase();
  const refs: GitHubRepoRef[] = [];
  const seen = new Set<string>();

  for (const repo of raw) {
    const fullName = repo.full_name;
    if (!fullName) continue;
    const ref = toRepoRef({
      accountId: account.id,
      accountLabel: account.label,
      fullName,
    });
    if (ownerFilter && ref.owner.toLowerCase() !== ownerFilter) continue;
    if (seen.has(ref.key)) continue;
    seen.add(ref.key);
    refs.push(ref);
  }
  return refs;
}

function isRepoAllowed(account: GitHubAccountConfig, fullName: string): boolean {
  const ref = toRepoRef({
    accountId: account.id,
    accountLabel: account.label,
    fullName,
  });
  if (account.discoverAll) {
    if (!account.owner) return true;
    return ref.owner.toLowerCase() === account.owner.toLowerCase();
  }
  return account.allowedRepositories.some(
    (allowed) => allowed.toLowerCase() === ref.fullName.toLowerCase(),
  );
}

/**
 * Resolve repos for an account.
 * Never mixes owners across accounts — discovery is scoped to that account's
 * owner/token, or to an explicit allowlist.
 */
export async function listAccountRepositories(
  account: GitHubAccountConfig,
): Promise<GitHubRepoRef[]> {
  if (!account.discoverAll && account.allowedRepositories.length) {
    return account.allowedRepositories.map((fullName) =>
      toRepoRef({
        accountId: account.id,
        accountLabel: account.label,
        fullName,
      }),
    );
  }

  return discoverRepositories(account);
}

export function filterReposForAccount(
  account: GitHubAccountConfig,
  candidates: string[],
): GitHubRepoRef[] {
  const out: GitHubRepoRef[] = [];
  for (const fullName of candidates) {
    if (!isRepoAllowed(account, fullName)) continue;
    out.push(
      toRepoRef({
        accountId: account.id,
        accountLabel: account.label,
        fullName,
      }),
    );
  }
  return out;
}

export async function getRepositoryDetails(
  account: GitHubAccountConfig,
  fullName: string,
) {
  const ref = toRepoRef({
    accountId: account.id,
    accountLabel: account.label,
    fullName,
  });
  if (!isRepoAllowed(account, ref.fullName)) {
    throw new Error(
      `Repository ${ref.fullName} is not allowed for GitHub account ${account.id}`,
    );
  }

  const data = await githubRequest<GhRepo>(
    account,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`,
  );

  return {
    ...ref,
    private: Boolean(data.private),
    url: data.html_url,
    description: data.description || undefined,
  };
}

export async function findAccountsOwningRepo(
  accounts: GitHubAccountConfig[],
  query: string,
): Promise<
  Array<{ accountId: string; accountLabel: string; fullName: string; key: string }>
> {
  const q = query.trim().toLowerCase();
  const matches: Array<{
    accountId: string;
    accountLabel: string;
    fullName: string;
    key: string;
  }> = [];

  for (const account of accounts) {
    const repos = await listAccountRepositories(account);
    for (const ref of repos) {
      const hay = `${ref.fullName} ${ref.name} ${ref.owner}`.toLowerCase();
      if (
        hay.includes(q) ||
        ref.name.toLowerCase() === q ||
        ref.fullName.toLowerCase() === q
      ) {
        matches.push({
          accountId: account.id,
          accountLabel: account.label,
          fullName: ref.fullName,
          key: ref.key,
        });
      }
    }
  }
  return matches;
}
