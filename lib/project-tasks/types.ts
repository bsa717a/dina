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
  createdByUserId: string | null;
  assigneeUserId: string | null;
  sectionId: string | null;
  sectionName: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectSectionRecord = {
  id: string;
  projectKey: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type NumberedProjectTask = ProjectTaskRecord & {
  number: number;
};
