import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { needsOnboarding, type AuthUser } from "@/lib/auth/types";
import {
  createMessage,
  getOrCreateDefaultConversation,
} from "@/lib/db/conversations";
import { checkDatabase } from "@/lib/db/client";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { formatRemainingTasksMessage } from "@/lib/project-tasks/format";
import { displayProjectName } from "@/lib/project-tasks/keys";
import { userCanAccessProject } from "@/lib/project-tasks/membership";
import { listProjectTasks } from "@/lib/project-tasks/store";

export const runtime = "nodejs";

const projectSchema = z.object({
  project: z.string().trim().min(1).max(80),
});

async function remainingForProject(user: AuthUser, rawProject: string) {
  const key = await userCanAccessProject(user, rawProject);
  if (!key) return null;
  const tasks = await listProjectTasks({ project: key });
  const name = displayProjectName(key);
  return {
    project: { key, name },
    tasks: tasks.map((task) => ({
      number: task.number,
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
    })),
    markdown: formatRemainingTasksMessage({
      projectKey: key,
      projectName: name,
      tasks,
    }),
  };
}

function serializeMessage(message: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  openaiResponseId: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    openaiResponseId: message.openaiResponseId,
    attachments: (message.attachments ?? []).map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  };
}

/** Cheap remaining-task read. No model. */
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

  const data = await remainingForProject(user, parsed.data.project);
  if (!data) return jsonError("Unknown project or no access.", 400);
  return NextResponse.json(data);
}

/** Persist the remaining list as an assistant message. No model. */
export async function POST(request: NextRequest) {
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

  const parsed = projectSchema.safeParse(json);
  if (!parsed.success) return jsonError("Project is required.");

  const data = await remainingForProject(user, parsed.data.project);
  if (!data) return jsonError("Unknown project or no access.", 400);

  const conversation = await getOrCreateDefaultConversation(
    user.id,
    user.assistantName,
  );
  const message = await createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: data.markdown,
  });

  return NextResponse.json({
    ...data,
    message: serializeMessage(message),
  });
}
