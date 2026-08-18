import type { AuthUser } from "@/lib/auth/types";
import { listOpenAttentionItems } from "@/lib/attention/store";
import { categoryLabel } from "@/lib/attention/types";
import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { memoryScopeForUser } from "@/lib/memory/scope";
import { listMemories } from "@/lib/memory/store";
import {
  displayProjectName,
  ensureProjectCatalog,
} from "@/lib/projects/catalog";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";
import { REMAINING_STATUSES } from "@/lib/project-tasks/types";

export type TodaysWinContext = {
  userName?: string;
  attention: Array<{
    category: string;
    subject: string;
    summary: string;
    recommendedAction: string;
    isBlocking: boolean;
  }>;
  remainingTasks: Array<{
    project: string;
    title: string;
    status: string;
  }>;
  commitments: Array<{
    title: string;
    content: string;
    importance: string;
  }>;
  error?: string;
};

function clip(text: string, max = 180): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function formatTodaysWinContext(ctx: TodaysWinContext): string {
  if (ctx.error) {
    return `Win context unavailable: ${ctx.error}. If you cannot recommend a grounded win, ask: What would make today a win?`;
  }

  const empty =
    !ctx.attention.length &&
    !ctx.remainingTasks.length &&
    !ctx.commitments.length;
  if (empty) {
    return `No open attention, remaining project tasks, or durable commitments found. Ask ${ctx.userName || "them"}: What would make today a win?`;
  }

  const lines: string[] = [];
  if (ctx.attention.length) {
    lines.push("Open attention (highest first):");
    for (const item of ctx.attention) {
      const flag = item.isBlocking ? " [blocking]" : "";
      lines.push(
        `- (${item.category})${flag} ${item.subject} — ${item.summary} Next: ${item.recommendedAction}`,
      );
    }
  }
  if (ctx.remainingTasks.length) {
    if (lines.length) lines.push("");
    lines.push("Remaining project work:");
    for (const task of ctx.remainingTasks) {
      lines.push(`- [${task.project}] (${task.status}) ${task.title}`);
    }
  }
  if (ctx.commitments.length) {
    if (lines.length) lines.push("");
    lines.push("Durable commitments:");
    for (const item of ctx.commitments) {
      lines.push(`- (${item.importance}) ${item.title} — ${item.content}`);
    }
  }
  return lines.join("\n");
}

export async function gatherTodaysWinContext(
  user?: AuthUser | null,
): Promise<TodaysWinContext> {
  const userName = user?.name || "Derek";
  try {
    const isMember = user?.role === "member";
    const projectKeys = user ? await listMemberProjectKeys(user) : [];
    const scope = user ? await memoryScopeForUser(user) : undefined;
    const [attentionRows, taskRows, commitmentRows] = await Promise.all([
      isMember
        ? Promise.resolve([])
        : listOpenAttentionItems({ wakeSnoozes: false }),
      prisma.projectTask.findMany({
        where: {
          status: { in: [...REMAINING_STATUSES] },
          ...(isMember ? { projectKey: { in: projectKeys } } : {}),
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 24,
      }),
      listMemories({ category: "commitments", limit: 8, scope }),
      ensureProjectCatalog().catch(() => []),
    ]);

    const attention = attentionRows.slice(0, 8).map((item) => ({
      category: categoryLabel(item.category),
      subject: clip(item.subject || item.summary, 120),
      summary: clip(item.summary),
      recommendedAction: clip(item.recommendedAction, 140),
      isBlocking: item.isBlocking,
    }));

    const remainingTasks = [...taskRows]
      .sort((a, b) => {
        if (a.status === b.status) return 0;
        return a.status === "in_progress" ? -1 : 1;
      })
      .slice(0, 12)
      .map((task) => ({
        project: displayProjectName(task.projectKey),
        title: clip(task.title, 120),
        status: task.status,
      }));

    const commitments = commitmentRows.slice(0, 6).map((item) => ({
      title: clip(item.title, 120),
      content: clip(item.content),
      importance: String(item.importance),
    }));

    return { userName, attention, remainingTasks, commitments };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("morning_ritual_win_context_failed", { error: message });
    return {
      userName,
      attention: [],
      remainingTasks: [],
      commitments: [],
      error: message,
    };
  }
}
