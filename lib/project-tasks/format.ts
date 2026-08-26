import { displayProjectName } from "@/lib/project-tasks/keys";
import type { NumberedProjectTask } from "@/lib/project-tasks/types";

export type RemainingTaskGroup = {
  projectKey: string;
  projectName: string;
  tasks: NumberedProjectTask[];
};

export function remainingTaskGroupsFromLists(
  lists: Array<{ projectKey: string; tasks: NumberedProjectTask[] }>,
): RemainingTaskGroup[] {
  return lists.map((list) => ({
    projectKey: list.projectKey,
    projectName: displayProjectName(list.projectKey),
    tasks: list.tasks,
  }));
}

function taskLine(task: NumberedProjectTask): string {
  const extra = task.description.trim() ? ` — ${task.description.trim()}` : "";
  return `${task.number}. [${task.status}] ${task.title}${extra}`;
}

/** Compact live backlog for SESSION RUNTIME. Recite from this; no list tool needed. */
export function formatRemainingTasksRuntime(
  groups: RemainingTaskGroup[],
): string {
  if (!groups.length) return "";
  const lines = [
    "Remaining project tasks (live this turn — already loaded):",
  ];
  for (const group of groups) {
    lines.push(`${group.projectName} (key: ${group.projectKey}):`);
    if (!group.tasks.length) {
      lines.push("- (none remaining)");
      lines.push(
        `There is no task #1 on ${group.projectName}. Do not use an earlier chat list from another project.`,
      );
      continue;
    }
    for (const task of group.tasks) {
      lines.push(taskLine(task));
    }
  }
  lines.push(
    "Numbers are 1-based remaining lists per project. Recite this block when asked for remaining tasks. Never show task IDs or UUIDs — numbered titles only. Do not call list_project_tasks just to read it. Call list_project_tasks only for includeDone, a status filter, or a project not listed here. Writes still use add_project_task / complete_project_task / update_project_task.",
  );
  return lines.join("\n");
}

export function isRemainingTasksChatContent(
  role: string,
  content: string,
): boolean {
  const text = content.trim();
  if (role === "user") return /^Show remaining tasks for /i.test(text);
  if (role === "assistant") {
    const first = text.split("\n")[0] ?? "";
    return (
      /^(Remaining tasks for |No remaining tasks for |Remaining project tasks \(live this turn)/i.test(
        text,
      ) ||
      /^Current .+\sbacklog\b/i.test(first) ||
      / — no remaining tasks\.?$/i.test(first)
    );
  }
  return false;
}

/** Remove leaked project-task ids from chat so the model cannot recopy them. */
export function stripTaskIdsFromChatContent(content: string): string {
  return content
    .replace(/^[ \t]*[-*]?\s*Task id:\s*\S+[ \t]*\n?/gim, "")
    .replace(/\s*\(task id:\s*[^)]+\)/gi, "")
    .replace(/\btask id:\s*[a-z0-9_-]+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function projectKeyFromTaskToolOutput(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as {
      data?: { task?: { projectKey?: unknown }; projectKey?: unknown };
    };
    const key = parsed.data?.task?.projectKey ?? parsed.data?.projectKey;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

/** One-line status for the composer strip. No model involved. */
export function formatRemainingTasksSnapshot(input: {
  projectName: string;
  tasks: Array<{ title: string }>;
}): string {
  if (!input.tasks.length) {
    return `${input.projectName} — nothing waiting.`;
  }
  const next = input.tasks[0]?.title.trim() || "an untitled task";
  return `${input.projectName} — ${input.tasks.length} remaining. Next: ${next}.`;
}

/** Numbered titles for the expanded strip. */
export function formatRemainingTaskLines(
  tasks: Array<{ number: number; title: string }>,
): string[] {
  return tasks.map((task) => `${task.number}. ${task.title}`);
}

/** User-facing remaining list. No model involved. */
export function formatRemainingTasksMessage(group: RemainingTaskGroup): string {
  if (!group.tasks.length) {
    return `No remaining tasks for ${group.projectName}.`;
  }
  const lines = [`Remaining tasks for ${group.projectName}:`, ""];
  lines.push(...formatRemainingTaskLines(group.tasks));
  return lines.join("\n");
}
