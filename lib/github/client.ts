import { getAccountAccessToken } from "@/lib/github/auth";
import type { GitHubAccountConfig } from "@/lib/github/types";

export class GitHubAccountError extends Error {
  readonly accountId: string;
  readonly status?: number;

  constructor(accountId: string, message: string, status?: number) {
    super(message);
    this.name = "GitHubAccountError";
    this.accountId = accountId;
    this.status = status;
  }
}

export async function githubRequest<T>(
  account: GitHubAccountConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccountAccessToken(account);
  const url = path.startsWith("http")
    ? path
    : `https://api.github.com${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "dina-chief-of-staff",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `GitHub API ${res.status} for account ${account.id}`;
    try {
      const json = JSON.parse(text) as { message?: string };
      if (json.message) message = `${json.message} (account ${account.id})`;
    } catch {
      if (text) message = `${message}: ${text.slice(0, 200)}`;
    }
    throw new GitHubAccountError(account.id, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
