import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { markAllAttentionDone } from "@/lib/attention/close";
import {
  formatAttentionWhen,
  isCalendarAttentionSource,
} from "@/lib/attention/format";
import { accountBadgeFromRaw } from "@/lib/attention/provider";
import { listOpenAttentionItems } from "@/lib/attention/store";
import { categoryLabel } from "@/lib/attention/types";
import { jsonError, unauthorized } from "@/lib/http";

export const runtime = "nodejs";

const patchSchema = z.object({
  action: z.enum(["mark_all_done"]),
});

function readOccurs(item: {
  source: string;
  deadlineAt: Date | null;
  rawJson: string | null;
}) {
  let occursAt: string | null = item.deadlineAt?.toISOString() ?? null;
  let occursEndAt: string | null = null;
  try {
    const raw = item.rawJson
      ? (JSON.parse(item.rawJson) as {
          occursAt?: string | null;
          occursEndAt?: string | null;
        })
      : null;
    if (raw?.occursAt) occursAt = raw.occursAt;
    if (raw?.occursEndAt) occursEndAt = raw.occursEndAt;
  } catch {
    // keep deadlineAt fallback
  }
  const whenLabel =
    isCalendarAttentionSource(item.source) || item.source === "todo"
      ? formatAttentionWhen(occursAt, occursEndAt)
      : null;
  return { occursAt, occursEndAt, whenLabel };
}

function readGitHubMeta(item: {
  source: string;
  sender: string | null;
  rawJson: string | null;
}) {
  let githubAccountId: string | null = null;
  let githubAccountLabel: string | null = null;
  let githubRepoKey: string | null = null;
  try {
    const raw = item.rawJson
      ? (JSON.parse(item.rawJson) as {
          githubAccountId?: string | null;
          githubAccountLabel?: string | null;
          githubRepoKey?: string | null;
        })
      : null;
    githubAccountId = raw?.githubAccountId ?? null;
    githubAccountLabel = raw?.githubAccountLabel ?? null;
    githubRepoKey = raw?.githubRepoKey ?? null;
  } catch {
    // ignore
  }
  if (item.source === "github" && !githubAccountLabel && item.sender) {
    const match = item.sender.match(/^GitHub \((.+)\)$/);
    if (match) githubAccountLabel = match[1];
  }
  return { githubAccountId, githubAccountLabel, githubRepoKey };
}

export async function GET() {
  if (!(await requireSession())) return unauthorized();

  const items = await listOpenAttentionItems();
  return NextResponse.json({
    items: items.map((item) => {
      const occurs = readOccurs(item);
      const github = readGitHubMeta(item);
      const account = accountBadgeFromRaw(item.rawJson, item.sourceId);
      return {
        id: item.id,
        source: item.source,
        sourceId: item.sourceId,
        category: item.category,
        categoryLabel: categoryLabel(item.category),
        sender: item.sender,
        subject: item.subject,
        summary: item.summary,
        whyItMatters: item.whyItMatters,
        recommendedAction: item.recommendedAction,
        askSummary: item.askSummary,
        needsResponse: item.needsResponse,
        hasDeadline: item.hasDeadline,
        deadlineAt: item.deadlineAt,
        occursAt: occurs.occursAt,
        occursEndAt: occurs.occursEndAt,
        whenLabel: occurs.whenLabel,
        connector: account.connector,
        accountLabel: account.accountLabel,
        accountEmail: account.accountEmail,
        githubAccountId: github.githubAccountId,
        githubAccountLabel: github.githubAccountLabel,
        githubRepoKey: github.githubRepoKey,
        isBlocking: item.isBlocking,
        canWait: item.canWait,
        shouldDraftReply: item.shouldDraftReply,
        canSendDraft:
          item.source === "email" ||
          item.source === "meeting_invite" ||
          item.source === "calendar",
        draftSubject: item.draftSubject,
        draftBody: item.draftBody,
        updatedAt: item.updatedAt,
      };
    }),
  });
}

export async function PATCH(request: NextRequest) {
  if (!(await requireSession())) return unauthorized();

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid attention action.");

  if (parsed.data.action === "mark_all_done") {
    const result = await markAllAttentionDone();
    return NextResponse.json({ ok: true, ...result });
  }

  return jsonError("Unsupported action.");
}
