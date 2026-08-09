import {
  attentionProviderFromSourceId,
  providerIdFromSourceId,
} from "@/lib/attention/provider";
import { graphIdFromSourceId } from "@/lib/attention/send";
import { prisma } from "@/lib/db/client";
import { getGitHubAccount } from "@/lib/github/config";
import { githubRequest } from "@/lib/github/client";
import { markGmailRead } from "@/lib/google/gmail";
import { graphRequest, userPath } from "@/lib/microsoft/graph";
import { logger } from "@/lib/logger";

type AttentionLike = {
  id: string;
  source: string;
  sourceId: string;
  subject: string | null;
  summary: string;
  rawJson: string | null;
};

type GhNotification = {
  id: string;
  unread?: boolean;
  subject?: { title?: string; type?: string };
};

function parseGitHubMeta(rawJson: string | null) {
  let githubAccountId: string | null = null;
  let githubRepoKey: string | null = null;
  let repoFullName: string | null = null;
  let prOrIssueNumber: number | null = null;
  try {
    const raw = rawJson
      ? (JSON.parse(rawJson) as {
          githubAccountId?: string | null;
          githubRepoKey?: string | null;
          payload?: { repoFullName?: string; number?: number };
          event?: {
            payload?: { repoFullName?: string; number?: number };
          };
        })
      : null;
    githubAccountId = raw?.githubAccountId ?? null;
    githubRepoKey = raw?.githubRepoKey ?? null;
    repoFullName =
      raw?.payload?.repoFullName ||
      raw?.event?.payload?.repoFullName ||
      null;
    const n = raw?.payload?.number ?? raw?.event?.payload?.number;
    if (typeof n === "number") prOrIssueNumber = n;
  } catch {
    // ignore
  }

  if (!repoFullName && githubRepoKey) {
    // repoKey is accountId:owner/repo
    const colon = githubRepoKey.indexOf(":");
    if (colon >= 0) repoFullName = githubRepoKey.slice(colon + 1);
  }
  if (!githubAccountId && githubRepoKey) {
    const colon = githubRepoKey.indexOf(":");
    if (colon > 0) githubAccountId = githubRepoKey.slice(0, colon);
  }

  return { githubAccountId, repoFullName, prOrIssueNumber };
}

async function markEmailRead(sourceId: string) {
  const messageId = providerIdFromSourceId(sourceId) || graphIdFromSourceId(sourceId);
  if (!messageId) return false;
  const provider = attentionProviderFromSourceId(sourceId);
  if (provider === "google") {
    await markGmailRead(messageId, true);
    return true;
  }
  await graphRequest(userPath(`/messages/${encodeURIComponent(messageId)}`), {
    method: "PATCH",
    body: { isRead: true },
  });
  return true;
}

function notificationMatches(
  note: GhNotification,
  item: AttentionLike,
  prOrIssueNumber: number | null,
) {
  const title = note.subject?.title || "";
  if (!title) return false;
  if (prOrIssueNumber != null) {
    if (
      new RegExp(`(?:^|\\W)#${prOrIssueNumber}(?:\\W|$)`).test(title) ||
      title.includes(`#${prOrIssueNumber}`)
    ) {
      return true;
    }
  }
  const subject = item.subject || "";
  if (subject && title.length >= 12 && subject.includes(title.slice(0, 40))) {
    return true;
  }
  if (subject && title.includes(subject.slice(0, 40))) return true;
  return false;
}

async function enrichMetaFromCos(item: AttentionLike) {
  const meta = parseGitHubMeta(item.rawJson);
  if (meta.githubAccountId && meta.repoFullName && meta.prOrIssueNumber != null) {
    return meta;
  }
  try {
    const cos = await prisma.cosDecisionRecord.findUnique({
      where: { eventId: item.sourceId },
    });
    if (!cos?.payloadJson) return meta;
    const payload = JSON.parse(cos.payloadJson) as {
      event?: {
        payload?: {
          accountId?: string;
          repoFullName?: string;
          repoKey?: string;
          number?: number;
        };
      };
    };
    const eventPayload = payload.event?.payload;
    return {
      githubAccountId:
        meta.githubAccountId ||
        (typeof eventPayload?.accountId === "string"
          ? eventPayload.accountId
          : null),
      repoFullName:
        meta.repoFullName ||
        (typeof eventPayload?.repoFullName === "string"
          ? eventPayload.repoFullName
          : null),
      prOrIssueNumber:
        meta.prOrIssueNumber ??
        (typeof eventPayload?.number === "number" ? eventPayload.number : null),
    };
  } catch {
    return meta;
  }
}

async function markGitHubNotificationsRead(item: AttentionLike) {
  const meta = await enrichMetaFromCos(item);
  if (!meta.githubAccountId || !meta.repoFullName) return false;

  const account = getGitHubAccount(meta.githubAccountId);
  if (!account) return false;

  const [owner, name] = meta.repoFullName.split("/");
  if (!owner || !name) return false;

  let prOrIssueNumber = meta.prOrIssueNumber;
  if (prOrIssueNumber == null) {
    const match = `${item.subject || ""} ${item.summary || ""}`.match(/#(\d+)/);
    if (match) prOrIssueNumber = Number(match[1]);
  }

  const notes = await githubRequest<GhNotification[]>(
    account,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/notifications?all=false&participating=false`,
  );

  let marked = 0;
  for (const note of notes) {
    if (!note.unread) continue;
    if (!notificationMatches(note, item, prOrIssueNumber)) continue;
    await githubRequest(account, `/notifications/threads/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    marked += 1;
  }
  return marked > 0;
}

/**
 * When Derek finishes with an attention item (Done / dismiss / send),
 * mark the underlying source as read so it does not keep pinging.
 * Failures are logged and never block the attention status update.
 */
export async function markAttentionSourceHandled(item: AttentionLike): Promise<{
  ok: boolean;
  channel: "email" | "github" | "none";
}> {
  try {
    if (item.source === "email") {
      const ok = await markEmailRead(item.sourceId);
      return { ok, channel: "email" };
    }
    if (item.source === "github") {
      const ok = await markGitHubNotificationsRead(item);
      return { ok, channel: "github" };
    }
    return { ok: false, channel: "none" };
  } catch (error) {
    logger.warn("attention_mark_handled_failed", {
      itemId: item.id,
      source: item.source,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, channel: item.source === "email" ? "email" : item.source === "github" ? "github" : "none" };
  }
}
