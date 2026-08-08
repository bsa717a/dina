export type GitHubAuthMode = "token" | "app";

export type GitHubAccountConfig = {
  /** Stable id used in env keys and API results, e.g. personal */
  id: string;
  /** Human label, defaults to id */
  label: string;
  authMode: GitHubAuthMode;
  /** Fine-grained or classic PAT (token mode) */
  token?: string;
  /** GitHub App installation auth */
  appId?: string;
  appPrivateKey?: string;
  installationId?: string;
  /**
   * Login/org this account covers, e.g. bsa717a or 4StudentLives.
   * Used when discovering all repos for the account.
   */
  owner?: string;
  /**
   * When true, list every repo visible for this account/owner.
   * When false, only allowedRepositories is used.
   */
  discoverAll: boolean;
  /** Full names owner/repo allowed for this account (ignored when discoverAll) */
  allowedRepositories: string[];
};

export type GitHubRepoRef = {
  accountId: string;
  accountLabel: string;
  owner: string;
  name: string;
  fullName: string;
  /** Collision-safe key: accountId:owner/name */
  key: string;
};

export type GitHubEventKind =
  | "commit"
  | "issue"
  | "pull_request"
  | "workflow_run"
  | "release"
  | "notification";

export type GitHubActivityEvent = {
  accountId: string;
  accountLabel: string;
  kind: GitHubEventKind;
  /** Native GitHub id / node id / run id as string */
  nativeId: string;
  /** Collision-safe event id across accounts */
  eventId: string;
  repoFullName: string;
  repoKey: string;
  title: string;
  summary: string;
  url?: string;
  author?: string;
  occurredAt?: string;
  raw: Record<string, unknown>;
};

export type GitHubAccountHealth = {
  accountId: string;
  accountLabel: string;
  ok: boolean;
  authMode: GitHubAuthMode;
  error?: string;
  repositoryCount?: number;
};
