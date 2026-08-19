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
    "Numbers are 1-based remaining lists per project. Recite this block when asked for remaining tasks. Do not call list_project_tasks just to read it. Call list_project_tasks only for includeDone, a status filter, or a project not listed here. Writes still use add_project_task / complete_project_task / update_project_task.",
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

/** User-facing remaining list. No model involved. */
export function formatRemainingTasksMessage(group: RemainingTaskGroup): string {
  if (!group.tasks.length) {
    return `No remaining tasks for ${group.projectName}.`;
  }
  const lines = [`Remaining tasks for ${group.projectName}:`, ""];
  for (const task of group.tasks) {
    lines.push(`${task.number}. ${task.title}`);
  }
  return lines.join("\n");
}
