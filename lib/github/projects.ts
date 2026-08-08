import { githubRequest } from "@/lib/github/client";
import { listAccountRepositories } from "@/lib/github/repos";
import type { GitHubAccountConfig, GitHubRepoRef } from "@/lib/github/types";
import { logger } from "@/lib/logger";

export type GitHubProjectBrief = {
  accountId: string;
  accountLabel: string;
  owner: string;
  name: string;
  fullName: string;
  key: string;
  description?: string;
  url?: string;
  language?: string;
  topics?: string[];
  defaultBranch?: string;
  pushedAt?: string;
  updatedAt?: string;
  private?: boolean;
  /** Short excerpt from README when available */
  readmeExcerpt?: string;
};

type GhRepoDetails = {
  full_name?: string;
  description?: string | null;
  html_url?: string;
  language?: string | null;
  topics?: string[];
  default_branch?: string;
  pushed_at?: string;
  updated_at?: string;
  private?: boolean;
};

type GhReadme = {
  content?: string;
  encoding?: string;
};

function excerptReadme(markdown: string, max = 1200): string {
  const cleaned = markdown
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]+\)/g, (m) => m.replace(/\[|\]|\([^)]+\)/g, ""))
    .replace(/[#>*_`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trim()}…`;
}

async function readmeExcerptFor(
  account: GitHubAccountConfig,
  ref: GitHubRepoRef,
): Promise<string | undefined> {
  try {
    const data = await githubRequest<GhReadme>(
      account,
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/readme`,
    );
    if (!data.content || data.encoding !== "base64") return undefined;
    const text = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString(
      "utf8",
    );
    const excerpt = excerptReadme(text);
    return excerpt || undefined;
  } catch {
    return undefined;
  }
}

export async function getProjectBrief(
  account: GitHubAccountConfig,
  ref: GitHubRepoRef,
  options?: { includeReadme?: boolean },
): Promise<GitHubProjectBrief> {
  const details = await githubRequest<GhRepoDetails>(
    account,
    `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`,
  );

  const brief: GitHubProjectBrief = {
    accountId: account.id,
    accountLabel: account.label,
    owner: ref.owner,
    name: ref.name,
    fullName: ref.fullName,
    key: ref.key,
    description: details.description || undefined,
    url: details.html_url,
    language: details.language || undefined,
    topics: details.topics?.length ? details.topics : undefined,
    defaultBranch: details.default_branch,
    pushedAt: details.pushed_at,
    updatedAt: details.updated_at,
    private: details.private,
  };

  if (options?.includeReadme !== false) {
    brief.readmeExcerpt = await readmeExcerptFor(account, ref);
  }

  return brief;
}

/**
 * Project catalog across accounts: what each repo is, not just its name.
 */
export async function listGitHubProjects(
  accounts: GitHubAccountConfig[],
  options?: { accountId?: string; includeReadme?: boolean },
): Promise<{
  projects: GitHubProjectBrief[];
  errors: Array<{ accountId: string; error: string }>;
}> {
  const selected = options?.accountId
    ? accounts.filter((a) => a.id === options.accountId?.toLowerCase())
    : accounts;

  const projects: GitHubProjectBrief[] = [];
  const errors: Array<{ accountId: string; error: string }> = [];

  for (const account of selected) {
    try {
      const repos = await listAccountRepositories(account);
      const briefs = await Promise.all(
        repos.map(async (ref) => {
          try {
            return await getProjectBrief(account, ref, {
              includeReadme: options?.includeReadme,
            });
          } catch (error) {
            logger.warn("github_project_brief_failed", {
              accountId: account.id,
              repo: ref.fullName,
              error: error instanceof Error ? error.message : "unknown",
            });
            return {
              accountId: account.id,
              accountLabel: account.label,
              owner: ref.owner,
              name: ref.name,
              fullName: ref.fullName,
              key: ref.key,
            } satisfies GitHubProjectBrief;
          }
        }),
      );
      projects.push(...briefs);
    } catch (error) {
      errors.push({
        accountId: account.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  projects.sort((a, b) => {
    const byAccount = a.accountId.localeCompare(b.accountId);
    if (byAccount !== 0) return byAccount;
    return a.fullName.localeCompare(b.fullName);
  });

  return { projects, errors };
}
