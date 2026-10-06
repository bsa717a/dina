import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { needsOnboarding } from "@/lib/auth/types";
import { checkDatabase } from "@/lib/db/client";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { displayProjectName } from "@/lib/project-tasks/keys";
import { userCanAccessProject } from "@/lib/project-tasks/membership";
import {
  addProjectSection,
  listProjectSections,
  requireProjectSection,
  requireProjectSectionById,
} from "@/lib/project-tasks/sections";
import {
  addProjectTask,
  listProjectTasks,
  resolveProjectTask,
  updateProjectTask,
} from "@/lib/project-tasks/store";

export const runtime = "nodejs";

const projectSchema = z.object({
  project: z.string().trim().min(1).max(80),
});

const sectionSchema = z.object({
  project: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
});

const taskSchema = z.object({
  project: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  sectionId: z.string().trim().min(1).max(80).optional(),
  section: z.string().trim().min(1).max(80).optional(),
});

const assignSchema = z
  .object({
    project: z.string().trim().min(1).max(80),
    number: z.number().int().positive().optional(),
    taskId: z.string().trim().min(1).optional(),
    sectionId: z.string().trim().min(1).nullable().optional(),
    section: z.string().trim().max(80).nullable().optional(),
  })
  .refine((value) => Boolean(value.number || value.taskId), {
    message: "Task number is required.",
  })
  .refine(
    (value) => value.sectionId !== undefined || value.section !== undefined,
    { message: "Section is required." },
  );

function publicTask(task: {
  number: number;
  id: string;
  title: string;
  status: string;
  sectionId: string | null;
  sectionName: string | null;
}) {
  return {
    number: task.number,
    id: task.id,
    title: task.title,
    status: task.status,
    sectionId: task.sectionId,
    sectionName: task.sectionName,
  };
}

async function boardFor(user: Parameters<typeof userCanAccessProject>[0], rawProject: string) {
  const key = await userCanAccessProject(user, rawProject);
  if (!key) return null;
  const [sections, tasks] = await Promise.all([
    listProjectSections(key),
    listProjectTasks({ project: key }),
  ]);
  return {
    project: { key, name: displayProjectName(key) },
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      sortOrder: section.sortOrder,
    })),
    tasks: tasks.map(publicTask),
  };
}

async function sectionIdForTask(
  projectKey: string,
  input: { sectionId?: string | null; section?: string | null },
): Promise<string | null> {
  if (input.sectionId !== undefined) {
    if (!input.sectionId) return null;
    const section = await requireProjectSectionById(projectKey, input.sectionId);
    return section.id;
  }
  if (input.section !== undefined) {
    if (!input.section) return null;
    const section = await requireProjectSection(projectKey, input.section);
    return section.id;
  }
  return null;
}

/** Sections and remaining tasks for the selected project. No model. */
export async function GET(request: Request) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (needsOnboarding(user)) return forbidden("Onboarding required.");

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  const parsed = projectSchema.safeParse({
    project: new URL(request.url).searchParams.get("project") ?? "",
  });
  if (!parsed.success) return jsonError("Project is required.");

  const data = await boardFor(user, parsed.data.project);
  if (!data) return jsonError("Unknown project or no access.", 400);
  return NextResponse.json(data);
}

/** Add a section, or add a task into a section. No model. */
export async function POST(request: Request) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (needsOnboarding(user)) return forbidden("Onboarding required.");

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }
  if (!json || typeof json !== "object") return jsonError("Invalid JSON body.");

  const body = json as Record<string, unknown>;
  if ("title" in body) {
    const parsed = taskSchema.safeParse(body);
    if (!parsed.success) return jsonError("Task title is required.");
    const key = await userCanAccessProject(user, parsed.data.project);
    if (!key) return jsonError("Unknown project or no access.", 400);
    try {
      const sectionId = await sectionIdForTask(key, parsed.data);
      const created = await addProjectTask({
        project: key,
        title: parsed.data.title,
        sectionId,
        source: "ui",
        createdByUserId: user.id,
      });
      const tasks = await listProjectTasks({ project: key });
      const numbered = tasks.find((task) => task.id === created.id) ?? {
        ...created,
        number: 0,
      };
      return NextResponse.json({ task: publicTask(numbered) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not add task.";
      return jsonError(message);
    }
  }

  const parsed = sectionSchema.safeParse(body);
  if (!parsed.success) return jsonError("Section name is required.");
  const key = await userCanAccessProject(user, parsed.data.project);
  if (!key) return jsonError("Unknown project or no access.", 400);
  try {
    const section = await addProjectSection({
      project: key,
      name: parsed.data.name,
    });
    return NextResponse.json({
      section: { id: section.id, name: section.name, sortOrder: section.sortOrder },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add section.";
    return jsonError(message);
  }
}

/** Move a remaining task into a section, or back to ungrouped. No model. */
export async function PATCH(request: Request) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (needsOnboarding(user)) return forbidden("Onboarding required.");

  const db = await checkDatabase();
  if (!db.ok) return jsonError("Database is unavailable.", 503);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = assignSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message || "Could not update the task.");
  }

  const key = await userCanAccessProject(user, parsed.data.project);
  if (!key) return jsonError("Unknown project or no access.", 400);

  try {
    const task = await resolveProjectTask({
      taskId: parsed.data.taskId,
      project: key,
      number: parsed.data.number,
    });
    if (task.projectKey !== key) {
      return jsonError("That task is not on this project.", 400);
    }
    const sectionId = await sectionIdForTask(key, parsed.data);
    const updated = await updateProjectTask(task.id, { sectionId });
    return NextResponse.json({
      task: publicTask({ ...updated, number: task.number }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not group the task.";
    return jsonError(message);
  }
}
