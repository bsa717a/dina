import { upsertProjectTask } from "@/lib/project-tasks/store";
import type { ProjectTaskStatus } from "@/lib/project-tasks/types";
import { logger } from "@/lib/logger";

type SeedTask = {
  title: string;
  description: string;
  status: ProjectTaskStatus;
  sortOrder: number;
};

/** Recovered Dina roadmap from 2026-08-07 chat (item 6 marked done). */
const DINA_SEED_TASKS: SeedTask[] = [
  {
    sortOrder: 1,
    title: "Search & Retrieval",
    description:
      'Search across conversations, email, documents, projects, and memory. Example: "Find every discussion about Beacon authentication."',
    status: "open",
  },
  {
    sortOrder: 2,
    title: "Calendar Intelligence",
    description:
      'Understand commitments and recommend schedule changes. Example: "This meeting conflicts with your elders quorum activity."',
    status: "open",
  },
  {
    sortOrder: 3,
    title: "Project Intelligence",
    description:
      'Maintain awareness of project status automatically. Example: "Beacon is blocked waiting on authentication."',
    status: "open",
  },
  {
    sortOrder: 4,
    title: "GitHub Intelligence",
    description:
      'Expand beyond the current foundation. Understand repository activity and development progress. Example: "The latest Beacon workflow failed."',
    status: "in_progress",
  },
  {
    sortOrder: 5,
    title: "AI Agent Management",
    description:
      'Track long-running AI tasks and surface completed work. Example: "Cursor finished implementing the Waiting On Engine."',
    status: "open",
  },
  {
    sortOrder: 6,
    title: "Waiting On Engine",
    description:
      'Track commitments without manual task lists. Example: "You\'ve been waiting six days for Breck\'s feedback."',
    status: "done",
  },
  {
    sortOrder: 7,
    title: "Writing Assistant",
    description:
      "Write in Derek's voice across every medium. Example: Draft an email to Adam that sounds like Derek wrote it.",
    status: "open",
  },
  {
    sortOrder: 8,
    title: "Daily Briefing",
    description:
      'Prepare Derek for the day in under two minutes. Example: "Today\'s win is completing the Beacon deployment review."',
    status: "open",
  },
  {
    sortOrder: 9,
    title: "Learning Engine",
    description:
      "Continuously improve from your decisions and corrections. Example: Learn that you prefer one recommended option instead of five.",
    status: "open",
  },
  {
    sortOrder: 10,
    title: "Authority Engine",
    description:
      "Gradually earn permission to perform actions. Example: Send an approved email without requiring additional confirmation.",
    status: "open",
  },
  {
    sortOrder: 11,
    title: "Additional Integrations",
    description:
      "Expand Dina's awareness beyond Microsoft 365 and GitHub. Example: Apple Notes, Apple Reminders, Google Calendar, Google Drive, SharePoint, Teams, Slack.",
    status: "open",
  },
];

let seeded = false;

export async function seedDinaProjectTasks(): Promise<{
  created: number;
  updated: number;
}> {
  if (seeded) return { created: 0, updated: 0 };
  let created = 0;
  let updated = 0;
  for (const seed of DINA_SEED_TASKS) {
    const result = await upsertProjectTask({
      projectKey: "dina",
      title: seed.title,
      description: seed.description,
      status: seed.status,
      sortOrder: seed.sortOrder,
      source: "seed",
      preserveExistingStatus: true,
    });
    if (result.created) created += 1;
    else updated += 1;
  }
  seeded = true;
  logger.info("dina_project_tasks_seeded", { created, updated });
  return { created, updated };
}

/** Test helper — reset in-memory gate. */
export function resetDinaProjectTaskSeedGate() {
  seeded = false;
}

export { DINA_SEED_TASKS };
