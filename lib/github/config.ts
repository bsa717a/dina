import type { GitHubAccountConfig } from "@/lib/github/types";
import { normalizeRepoFullName } from "@/lib/github/identity";

function envKey(accountId: string, suffix: string) {
  const upper = accountId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `GITHUB_${upper}_${suffix}`;
}

function readList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readPrivateKey(accountId: string): string | undefined {
  const inline = process.env[envKey(accountId, "APP_PRIVATE_KEY")]?.trim();
  if (inline) {
    return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  }
  return undefined;
}

export function parseGitHubAccountIds(
  raw = process.env.GITHUB_ACCOUNTS,
): string[] {
  return readList(raw).map((id) => id.toLowerCase());
}

export function loadGitHubAccountConfig(
  accountId: string,
): GitHubAccountConfig | null {
  const id = accountId.trim().toLowerCase();
  if (!id) return null;

  const label =
    process.env[envKey(id, "LABEL")]?.trim() || id;
  const owner = process.env[envKey(id, "OWNER")]?.trim() || undefined;

  const allowedRaw = readList(process.env[envKey(id, "ALLOWED_REPOSITORIES")]);
  const wantsAll =
    allowedRaw.length === 0 ||
    allowedRaw.some((entry) => entry === "*" || entry.toLowerCase() === "all");
  const allowedRepositories = allowedRaw
    .filter((entry) => entry !== "*" && entry.toLowerCase() !== "all")
    .map((name) => normalizeRepoFullName(name));
  // Empty allowlist or * / all → discover every repo for OWNER (or token scope).
  const discoverAll = wantsAll || allowedRepositories.length === 0;

  const token = process.env[envKey(id, "TOKEN")]?.trim();
  const appId = process.env[envKey(id, "APP_ID")]?.trim();
  const installationId = process.env[envKey(id, "INSTALLATION_ID")]?.trim();
  const appPrivateKey = readPrivateKey(id);

  if (token) {
    return {
      id,
      label,
      authMode: "token",
      token,
      owner,
      discoverAll,
      allowedRepositories,
    };
  }

  if (appId && installationId && appPrivateKey) {
    return {
      id,
      label,
      authMode: "app",
      appId,
      installationId,
      appPrivateKey,
      owner,
      discoverAll,
      allowedRepositories,
    };
  }

  return null;
}

export function getGitHubAccounts(): GitHubAccountConfig[] {
  const ids = parseGitHubAccountIds();
  const accounts: GitHubAccountConfig[] = [];
  for (const id of ids) {
    const account = loadGitHubAccountConfig(id);
    if (account) accounts.push(account);
  }
  return accounts;
}

export function getGitHubAccount(accountId: string): GitHubAccountConfig | null {
  const id = accountId.trim().toLowerCase();
  const fromList = getGitHubAccounts().find((a) => a.id === id);
  if (fromList) return fromList;
  return loadGitHubAccountConfig(id);
}

export function isGitHubConfigured(): boolean {
  return getGitHubAccounts().length > 0;
}

export function listGitHubAccountSummaries() {
  return getGitHubAccounts().map((account) => ({
    id: account.id,
    label: account.label,
    authMode: account.authMode,
    owner: account.owner ?? null,
    discoverAll: account.discoverAll,
    allowedRepositories: account.allowedRepositories,
  }));
}
