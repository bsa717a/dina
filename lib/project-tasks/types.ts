export const PROJECT_TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type ProjectTaskStatus = (typeof PROJECT_TASK_STATUSES)[number];

export const REMAINING_STATUSES: ProjectTaskStatus[] = ["open", "in_progress"];

export type ProjectTaskRecord = {
  id: string;
  projectKey: string;
  title: string;
  description: string;
  status: ProjectTaskStatus;
  sortOrder: number;
  source: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NumberedProjectTask = ProjectTaskRecord & {
  number: number;
};
