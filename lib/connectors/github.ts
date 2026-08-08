import type { NormalizedEvent } from "@/lib/chief-of-staff/types";
import type { Connector } from "@/lib/connectors/types";
import { collectAllGitHubActivity } from "@/lib/github/activity";
import { getGitHubAccounts, isGitHubConfigured } from "@/lib/github/config";
import { logger } from "@/lib/logger";

function mapActivityToEvent(input: {
  accountId: string;
  accountLabel: string;
  kind: string;
  eventId: string;
  repoFullName: string;
  repoKey: string;
  title: string;
  summary: string;
  url?: string;
  author?: string;
  occurredAt?: string;
  raw: Record<string, unknown>;
}): NormalizedEvent | null {
  const base = {
    eventId: `github:${input.eventId}`,
    occurredAt: input.occurredAt || new Date().toISOString(),
    title: `[${input.accountLabel}] ${input.repoFullName}: ${input.title}`,
    summary: [
      `Account: ${input.accountId} (${input.accountLabel})`,
      `Repository: ${input.repoFullName}`,
      input.summary,
      input.author ? `Author: ${input.author}` : "",
      input.url || "",
    ]
      .filter(Boolean)
      .join("\n"),
    actor: input.author || `GitHub (${input.accountLabel})`,
    projectHint: input.repoKey,
    connector: "github" as const,
    payload: {
      accountId: input.accountId,
      accountLabel: input.accountLabel,
      repoFullName: input.repoFullName,
      repoKey: input.repoKey,
      githubEventId: input.eventId,
      url: input.url,
      ...input.raw,
    },
  };

  if (input.kind === "pull_request") {
    const draft = Boolean(input.raw.draft);
    return {
      ...base,
      // Open non-draft PRs are treated as ready for Derek's review.
      type: draft ? "PullRequestOpened" : "PullRequestReadyForReview",
    };
  }

  if (input.kind === "issue") {
    return { ...base, type: "IssueAssigned" };
  }

  if (input.kind === "workflow_run") {
    const conclusion = String(input.raw.conclusion || "");
    if (
      conclusion === "failure" ||
      conclusion === "timed_out" ||
      conclusion === "cancelled"
    ) {
      return { ...base, type: "WorkflowFailed" };
    }
    if (conclusion === "success") {
      return { ...base, type: "WorkflowSucceeded" };
    }
    return null;
  }

  return null;
}

export const githubConnector: Connector = {
  id: "github",
  async collect() {
    if (!isGitHubConfigured()) return [];

    try {
      const { events, health } = await collectAllGitHubActivity(
        getGitHubAccounts(),
      );
      const out: NormalizedEvent[] = [];

      for (const account of health) {
        if (!account.ok && account.error) {
          out.push({
            eventId: `github:auth:${account.accountId}`,
            type: "IntegrationAlert",
            occurredAt: new Date().toISOString(),
            title: `GitHub account ${account.accountLabel} authentication failed`,
            summary: [
              `Account: ${account.accountId} (${account.accountLabel})`,
              `Error: ${account.error}`,
              "Other GitHub accounts continue independently.",
            ].join("\n"),
            actor: `GitHub (${account.accountLabel})`,
            connector: "github",
            payload: {
              accountId: account.accountId,
              accountLabel: account.accountLabel,
              kind: "auth_failure",
            },
          });
        }
      }

      for (const event of events) {
        if (event.kind === "commit") continue;
        const mapped = mapActivityToEvent(event);
        if (mapped) out.push(mapped);
      }

      return out;
    } catch (error) {
      logger.warn("connector_github_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return [];
    }
  },
};
