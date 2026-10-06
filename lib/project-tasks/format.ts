import { displayProjectName } from "@/lib/project-tasks/keys";
import type { NumberedProjectTask } from "@/lib/project-tasks/types";

export type RemainingTaskGroup = {
  projectKey: string;
  projectName: string;
  tasks: NumberedProjectTask[];
  sections?: Array<{ id: string; name: string }>;
};

function taskBuckets(
  tasks: NumberedProjectTask[],
  sections: Array<{ id: string; name: string }> | undefined,
): {
  groups: Array<{ name: string; tasks: NumberedProjectTask[] }>;
  ungrouped: NumberedProjectTask[];
  hasSections: boolean;
} {
  const named = (sections ?? []).map((section) => ({
    id: section.id,
    name: section.name,
    tasks: [] as NumberedProjectTask[],
  }));
  const byId = new Map(named.map((group) => [group.id, group]));
  const extras = new Map<string, { name: string; tasks: NumberedProjectTask[] }>();
  const ungrouped: NumberedProjectTask[] = [];

  for (const task of tasks) {
    const known = task.sectionId ? byId.get(task.sectionId) : undefined;
    if (known) {
      known.tasks.push(task);
      continue;
    }
    const label = task.sectionName?.trim();
    if (label) {
      const key = label.toLowerCase();
      const extra = extras.get(key) ?? { name: label, tasks: [] };
      extra.tasks.push(task);
      extras.set(key, extra);
      continue;
    }
    ungrouped.push(task);
  }

  const groups = [
    ...named.map((group) => ({ name: group.name, tasks: group.tasks })),
    ...extras.values(),
  ];
  return { groups, ungrouped, hasSections: groups.length > 0 };
}

export function remainingTaskGroupsFromLists(
  lists: Array<{
    projectKey: string;
    tasks: NumberedProjectTask[];
    sections?: Array<{ id: string; name: string }>;
  }>,
): RemainingTaskGroup[] {
  return lists.map((list) => ({
    projectKey: list.projectKey,
    projectName: displayProjectName(list.projectKey),
    tasks: list.tasks,
    sections: list.sections,
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
      if (group.sections?.length) {
        lines.push(
          `Sections: ${group.sections.map((section) => section.name).join(", ")}`,
        );
      }
      lines.push("- (none remaining)");
      lines.push(
        `There is no task #1 on ${group.projectName}. Do not use an earlier chat list from another project.`,
      );
      continue;
    }
    const grouped = taskBuckets(group.tasks, group.sections);
    if (!grouped.hasSections) {
      for (const task of group.tasks) {
        lines.push(taskLine(task));
      }
      continue;
    }
    for (const section of grouped.groups) {
      lines.push(section.name);
      if (!section.tasks.length) lines.push("- (none yet)");
      else {
        for (const task of section.tasks) lines.push(taskLine(task));
      }
    }
    if (grouped.ungrouped.length) {
      lines.push("Ungrouped");
      for (const task of grouped.ungrouped) lines.push(taskLine(task));
    }
  }
  lines.push(
    "Numbers are 1-based remaining lists per project. Recite this block when asked for remaining tasks. When it has section headings, keep them — a section groups that project's tasks. Never show task IDs, section IDs, or UUIDs — numbered titles only. Do not invent sub-bullets, owners, timelines, or implementation plans unless asked to break a task down. Do not call list_project_tasks just to read it. Call list_project_tasks only for includeDone, a status filter, or a project not listed here. Writes still use add_project_task / complete_project_task / update_project_task / add_project_section.",
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

export function isRemainingTasksListForProject(
  role: string,
  content: string,
  projectName: string,
): boolean {
  if (!projectName.trim()) return false;
  const text = content.trim();
  return (
    text.startsWith(`Remaining tasks for ${projectName}:`) ||
    text === `No remaining tasks for ${projectName}.`
  );
}

/** Keep only the latest remaining-task list for the selected project. */
export function filterRemainingTaskChatMessages<
  T extends { id: string; role: string; content: string },
>(messages: T[], projectName?: string | null): T[] {
  const lastForProject = projectName
    ? [...messages]
        .reverse()
        .find((message) =>
          isRemainingTasksListForProject(
            message.role,
            message.content,
            projectName,
          ),
        )
    : undefined;
  return messages.filter((message) => {
    const leftover =
      message.id.startsWith("tasks-") ||
      isRemainingTasksChatContent(message.role, message.content);
    if (!leftover) return true;
    return lastForProject != null && message.id === lastForProject.id;
  });
}

/** Keep a just-shown remaining list if a conversation reload has not caught up. */
export function mergeRemainingTaskChatMessages<
  T extends { id: string; role: string; content: string },
>(
  serverMessages: T[],
  localMessages: T[],
  projectName?: string | null,
): T[] {
  const filtered = filterRemainingTaskChatMessages(serverMessages, projectName);
  if (!projectName) return filtered;
  const shown = [...localMessages]
    .reverse()
    .find((message) =>
      isRemainingTasksListForProject(
        message.role,
        message.content,
        projectName,
      ),
    );
  if (!shown) return filtered;
  if (
    filtered.some((message) =>
      isRemainingTasksListForProject(
        message.role,
        message.content,
        projectName,
      ),
    )
  ) {
    return filtered;
  }
  return filterRemainingTaskChatMessages([...filtered, shown], projectName);
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
  const grouped = taskBuckets(group.tasks, group.sections);
  if (!group.tasks.length && !grouped.hasSections) {
    return `No remaining tasks for ${group.projectName}.`;
  }
  if (!grouped.hasSections) {
    const lines = [`Remaining tasks for ${group.projectName}:`, ""];
    lines.push(...formatRemainingTaskLines(group.tasks));
    return lines.join("\n");
  }

  const lines = [`Remaining tasks for ${group.projectName}:`, ""];
  for (const section of grouped.groups) {
    lines.push(section.name);
    if (!section.tasks.length) lines.push("(none yet)");
    else lines.push(...formatRemainingTaskLines(section.tasks));
    lines.push("");
  }
  if (grouped.ungrouped.length) {
    lines.push("Ungrouped");
    lines.push(...formatRemainingTaskLines(grouped.ungrouped));
  }
  return lines.join("\n").trimEnd();
}
