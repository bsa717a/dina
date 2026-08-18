import {
  formatRemainingTasksRuntime,
  remainingTaskGroupsFromLists,
} from "@/lib/project-tasks/format";
import { listProjectTasks } from "@/lib/project-tasks/store";

export async function loadRemainingTasksBlocks(
  projectKeys: string[],
): Promise<string> {
  const unique = [
    ...new Set(projectKeys.map((key) => key.trim()).filter(Boolean)),
  ];
  if (!unique.length) return "";
  const lists = await Promise.all(
    unique.map(async (projectKey) => ({
      projectKey,
      tasks: await listProjectTasks({ project: projectKey }),
    })),
  );
  return formatRemainingTasksRuntime(remainingTaskGroupsFromLists(lists));
}

export async function loadRemainingTasksBlock(
  projectKey: string,
): Promise<string> {
  return loadRemainingTasksBlocks([projectKey]);
}
