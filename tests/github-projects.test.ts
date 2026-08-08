import { describe, expect, it, vi, afterEach } from "vitest";
import { listGitHubProjects } from "@/lib/github/projects";
import type { GitHubAccountConfig } from "@/lib/github/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("listGitHubProjects", () => {
  it("returns project briefs with account identity and description", async () => {
    const account: GitHubAccountConfig = {
      id: "4studentlives",
      label: "4studentlives",
      authMode: "token",
      token: "ok",
      owner: "4StudentLives",
      discoverAll: false,
      allowedRepositories: ["4StudentLives/beacon"],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/repos/4StudentLives/beacon/readme")) {
          return new Response(
            JSON.stringify({
              encoding: "base64",
              content: Buffer.from(
                "# Beacon\n\nStudent engagement platform for districts.",
              ).toString("base64"),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/repos/4StudentLives/beacon")) {
          return new Response(
            JSON.stringify({
              full_name: "4StudentLives/beacon",
              description: "Beacon product monorepo",
              html_url: "https://github.com/4StudentLives/beacon",
              language: "TypeScript",
              topics: ["education"],
              default_branch: "main",
              pushed_at: "2026-08-01T00:00:00Z",
              private: true,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ message: "not found" }), {
          status: 404,
        });
      }),
    );

    const { projects, errors } = await listGitHubProjects([account]);
    expect(errors).toHaveLength(0);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      accountId: "4studentlives",
      fullName: "4StudentLives/beacon",
      description: "Beacon product monorepo",
      language: "TypeScript",
    });
    expect(projects[0].readmeExcerpt).toMatch(/Student engagement/i);
  });
});
