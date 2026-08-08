import type OpenAI from "openai";
import { isGitHubConfigured } from "@/lib/github/config";

type FunctionTool = OpenAI.Responses.FunctionTool;

function fn(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): FunctionTool {
  return {
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      additionalProperties: false,
      ...parameters,
    },
    strict: false,
  };
}

export function getGitHubToolDefinitions(): FunctionTool[] {
  if (!isGitHubConfigured()) return [];

  return [
    fn(
      "list_github_accounts",
      "List Derek's connected GitHub accounts (ids/labels) and their allowed repositories. Use when asked which accounts are connected.",
      { properties: {}, required: [] },
    ),
    fn(
      "list_github_repositories",
      "List allowed repositories, always including accountId/accountLabel so same-named repos across accounts do not collide.",
      {
        properties: {
          accountId: {
            type: "string",
            description: "Optional account id filter, e.g. personal or 4studentlives.",
          },
        },
        required: [],
      },
    ),
    fn(
      "list_github_projects",
      "Project catalog for Derek's GitHub work: description, language, topics, recent push, and a short README excerpt for each repo. Use when asked what projects exist, what Beacon/dashboard/etc. is, or for context before advising. Always includes accountId.",
      {
        properties: {
          accountId: {
            type: "string",
            description: "Optional account id filter, e.g. personal or 4studentlives.",
          },
          includeReadme: {
            type: "boolean",
            description: "Include README excerpt (default true).",
          },
        },
        required: [],
      },
    ),
    fn(
      "github_activity",
      "Cross-account GitHub activity (PRs, issues, commits, workflow runs). Every event includes accountId. One account failing does not block others. Use for 'what changed across both GitHub accounts' or account-scoped questions.",
      {
        properties: {
          accountId: {
            type: "string",
            description: "Optional: personal or 4studentlives (or other configured id).",
          },
          kind: {
            type: "string",
            description:
              "Optional filter: commit | issue | pull_request | workflow_run",
          },
          limit: { type: "number", description: "Max events (1-100). Default 40." },
        },
        required: [],
      },
    ),
    fn(
      "which_github_account_owns_repo",
      "Resolve which GitHub account owns a repository by name or owner/repo. Handles same repo name under different owners/accounts.",
      {
        properties: {
          query: {
            type: "string",
            description: "Repo name or owner/repo, e.g. Beacon or 4StudentLives/beacon",
          },
        },
        required: ["query"],
      },
    ),
  ];
}
