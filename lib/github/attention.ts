import { collectAllGitHubActivity } from "@/lib/github/activity";
import { getGitHubAccounts, isGitHubConfigured } from "@/lib/github/config";
import type { CollectedSignal } from "@/lib/attention/types";

/**
 * Map GitHub activity into Attention Engine signals.
 * sourceId is account-scoped so identical repo names never collide.
 */
export async function collectGitHubAttentionSignals(): Promise<CollectedSignal[]> {
  if (!isGitHubConfigured()) return [];

  const { events, health } = await collectAllGitHubActivity(getGitHubAccounts());
  const signals: CollectedSignal[] = [];

  for (const account of health) {
    if (!account.ok && account.error) {
      signals.push({
        source: "github",
        sourceId: `github:${account.accountId}:auth_error`,
        sender: `GitHub (${account.accountLabel})`,
        subject: `GitHub account ${account.accountLabel} authentication failed`,
        preview: [
          `Account: ${account.accountId} (${account.accountLabel})`,
          `Error: ${account.error}`,
          "Other GitHub accounts continue to work independently.",
        ].join("\n"),
        receivedAt: new Date().toISOString(),
        raw: {
          accountId: account.accountId,
          accountLabel: account.accountLabel,
          kind: "auth_failure",
        },
      });
    }
  }

  for (const event of events) {
    // Attention focuses on actionable PR/issue/workflow failures, not every commit.
    if (event.kind === "commit") continue;
    const isFailedWorkflow =
      event.kind === "workflow_run" &&
      (event.raw.conclusion === "failure" ||
        event.raw.conclusion === "timed_out" ||
        event.raw.conclusion === "cancelled");
    if (event.kind === "workflow_run" && !isFailedWorkflow) continue;

    signals.push({
      source: "github",
      sourceId: event.eventId,
      sender: `GitHub (${event.accountLabel})`,
      subject: `[${event.accountLabel}] ${event.repoFullName}: ${event.title}`,
      preview: [
        `Account: ${event.accountId} (${event.accountLabel})`,
        `Repository: ${event.repoFullName}`,
        `Repo key: ${event.repoKey}`,
        `Kind: ${event.kind}`,
        event.summary,
        event.author ? `Author: ${event.author}` : "",
        event.url || "",
      ]
        .filter(Boolean)
        .join("\n"),
      receivedAt: event.occurredAt,
      raw: {
        accountId: event.accountId,
        accountLabel: event.accountLabel,
        kind: event.kind,
        repoFullName: event.repoFullName,
        repoKey: event.repoKey,
        eventId: event.eventId,
        url: event.url,
      },
    });
  }

  return signals;
}
