import { afterEach, describe, expect, it, vi } from "vitest";
import { collectAllGitHubActivity } from "@/lib/github/activity";
import {
  getGitHubAccounts,
  parseGitHubAccountIds,
} from "@/lib/github/config";
import {
  dedupeActivityEvents,
  eventId,
  repoKey,
  toRepoRef,
} from "@/lib/github/identity";
import {
  filterReposForAccount,
  findAccountsOwningRepo,
  listAccountRepositories,
} from "@/lib/github/repos";
import type { GitHubAccountConfig, GitHubActivityEvent } from "@/lib/github/types";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setTwoAccounts() {
  process.env.GITHUB_ACCOUNTS = "personal,4studentlives";
  process.env.GITHUB_PERSONAL_TOKEN = "ghp_personal_test";
  process.env.GITHUB_PERSONAL_ALLOWED_REPOSITORIES =
    "derekfowler/beacon,derekfowler/notes";
  process.env.GITHUB_4STUDENTLIVES_TOKEN = "ghp_org_test";
  process.env.GITHUB_4STUDENTLIVES_ALLOWED_REPOSITORIES =
    "4StudentLives/beacon,4StudentLives/platform";
  process.env.GITHUB_4STUDENTLIVES_LABEL = "4studentlives";
}

describe("GitHub multi-account config", () => {
  it("loads two connected accounts with separate credentials and repo scopes", () => {
    setTwoAccounts();
    expect(parseGitHubAccountIds()).toEqual(["personal", "4studentlives"]);
    const accounts = getGitHubAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      id: "personal",
      authMode: "token",
      token: "ghp_personal_test",
      discoverAll: false,
    });
    expect(accounts[1]).toMatchObject({
      id: "4studentlives",
      label: "4studentlives",
      authMode: "token",
      token: "ghp_org_test",
      discoverAll: false,
    });
    expect(accounts[0].allowedRepositories).toContain("derekfowler/beacon");
    expect(accounts[1].allowedRepositories).toContain("4StudentLives/beacon");
    expect(accounts[0].token).not.toEqual(accounts[1].token);
  });

  it("treats owner + empty allowlist as discover-all for that account", () => {
    process.env.GITHUB_ACCOUNTS = "personal,4studentlives";
    process.env.GITHUB_PERSONAL_TOKEN = "ghp_personal_test";
    process.env.GITHUB_PERSONAL_OWNER = "bsa717a";
    delete process.env.GITHUB_PERSONAL_ALLOWED_REPOSITORIES;
    process.env.GITHUB_4STUDENTLIVES_TOKEN = "ghp_org_test";
    process.env.GITHUB_4STUDENTLIVES_OWNER = "4StudentLives";
    delete process.env.GITHUB_4STUDENTLIVES_ALLOWED_REPOSITORIES;

    const accounts = getGitHubAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      id: "personal",
      owner: "bsa717a",
      discoverAll: true,
      allowedRepositories: [],
    });
    expect(accounts[1]).toMatchObject({
      id: "4studentlives",
      owner: "4StudentLives",
      discoverAll: true,
      allowedRepositories: [],
    });
  });

  it("supports GitHub App installation credentials per account", () => {
    process.env.GITHUB_ACCOUNTS = "personal";
    process.env.GITHUB_PERSONAL_APP_ID = "123";
    process.env.GITHUB_PERSONAL_INSTALLATION_ID = "456";
    process.env.GITHUB_PERSONAL_APP_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA\\n-----END RSA PRIVATE KEY-----";
    process.env.GITHUB_PERSONAL_ALLOWED_REPOSITORIES = "derekfowler/notes";
    delete process.env.GITHUB_PERSONAL_TOKEN;

    const accounts = getGitHubAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].authMode).toBe("app");
    expect(accounts[0].installationId).toBe("456");
  });
});

describe("repo identity and filtering", () => {
  it("prevents same repository name under different owners from colliding", () => {
    const personal = toRepoRef({
      accountId: "personal",
      accountLabel: "personal",
      fullName: "derekfowler/beacon",
    });
    const org = toRepoRef({
      accountId: "4studentlives",
      accountLabel: "4studentlives",
      fullName: "4StudentLives/beacon",
    });
    expect(personal.name).toBe("beacon");
    expect(org.name).toBe("beacon");
    expect(personal.key).not.toEqual(org.key);
    expect(personal.key).toBe(repoKey("personal", "derekfowler/beacon"));
    expect(org.key).toBe(repoKey("4studentlives", "4StudentLives/beacon"));
  });

  it("filters repositories per account allowlist", () => {
    const account: GitHubAccountConfig = {
      id: "4studentlives",
      label: "4studentlives",
      authMode: "token",
      token: "x",
      discoverAll: false,
      allowedRepositories: ["4StudentLives/beacon", "4StudentLives/platform"],
    };
    const filtered = filterReposForAccount(account, [
      "4StudentLives/beacon",
      "derekfowler/beacon",
      "4StudentLives/other",
    ]);
    expect(filtered.map((r) => r.fullName)).toEqual(["4StudentLives/beacon"]);
  });

  it("discovers all repos for an owner when allowlist is empty", async () => {
    const account: GitHubAccountConfig = {
      id: "personal",
      label: "personal",
      authMode: "token",
      token: "ok",
      owner: "bsa717a",
      discoverAll: true,
      allowedRepositories: [],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/orgs/bsa717a/repos")) {
          return new Response(JSON.stringify({ message: "Not Found" }), {
            status: 404,
          });
        }
        if (url.includes("/users/bsa717a/repos")) {
          return new Response(
            JSON.stringify([
              { full_name: "bsa717a/notes", owner: { login: "bsa717a" } },
              { full_name: "bsa717a/dina", owner: { login: "bsa717a" } },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
        });
      }),
    );

    const repos = await listAccountRepositories(account);
    expect(repos.map((r) => r.fullName).sort()).toEqual([
      "bsa717a/dina",
      "bsa717a/notes",
    ]);
  });

  it("resolves which account owns Beacon without assuming a single owner", async () => {
    setTwoAccounts();
    const matches = await findAccountsOwningRepo(getGitHubAccounts(), "Beacon");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.accountId).sort()).toEqual([
      "4studentlives",
      "personal",
    ]);
    expect(new Set(matches.map((m) => m.fullName)).size).toBe(2);
  });
});

describe("cross-account activity", () => {
  it("dedupes cross-account summaries without collapsing distinct accounts", () => {
    const events: GitHubActivityEvent[] = [
      {
        accountId: "personal",
        accountLabel: "personal",
        kind: "pull_request",
        nativeId: "1",
        eventId: eventId("personal", "pull_request", "1"),
        repoFullName: "derekfowler/beacon",
        repoKey: repoKey("personal", "derekfowler/beacon"),
        title: "PR personal",
        summary: "personal",
        raw: {},
      },
      {
        accountId: "personal",
        accountLabel: "personal",
        kind: "pull_request",
        nativeId: "1",
        eventId: eventId("personal", "pull_request", "1"),
        repoFullName: "derekfowler/beacon",
        repoKey: repoKey("personal", "derekfowler/beacon"),
        title: "PR personal duplicate",
        summary: "dup",
        raw: {},
      },
      {
        accountId: "4studentlives",
        accountLabel: "4studentlives",
        kind: "pull_request",
        nativeId: "1",
        eventId: eventId("4studentlives", "pull_request", "1"),
        repoFullName: "4StudentLives/beacon",
        repoKey: repoKey("4studentlives", "4StudentLives/beacon"),
        title: "PR org",
        summary: "org",
        raw: {},
      },
    ];

    const deduped = dedupeActivityEvents(events);
    expect(deduped).toHaveLength(2);
    expect(deduped.map((e) => e.accountId).sort()).toEqual([
      "4studentlives",
      "personal",
    ]);
  });

  it("keeps one account healthy when the other fails", async () => {
    const healthy: GitHubAccountConfig = {
      id: "personal",
      label: "personal",
      authMode: "token",
      token: "ok",
      discoverAll: false,
      allowedRepositories: ["derekfowler/notes"],
    };
    const broken: GitHubAccountConfig = {
      id: "4studentlives",
      label: "4studentlives",
      authMode: "token",
      token: "bad",
      discoverAll: false,
      allowedRepositories: ["4StudentLives/platform"],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("4StudentLives/platform")) {
          return new Response(JSON.stringify({ message: "Bad credentials" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/pulls") || url.includes("/issues") || url.includes("/commits")) {
          return new Response("[]", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/actions/runs")) {
          return new Response(JSON.stringify({ workflow_runs: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
        });
      }),
    );

    const result = await collectAllGitHubActivity([healthy, broken]);
    expect(result.health.find((h) => h.accountId === "personal")?.ok).toBe(true);
    expect(result.health.find((h) => h.accountId === "4studentlives")?.ok).toBe(
      false,
    );
    expect(
      result.health.find((h) => h.accountId === "4studentlives")?.error,
    ).toMatch(/Bad credentials|401/i);
    expect(result.events.every((e) => e.accountId === "personal")).toBe(true);
  });
});
