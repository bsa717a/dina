/**
 * Structured Piper commands for Slack (`/piper …` and @Piper verb form).
 *
 * Routing is token-based (tasks|list, add, done) — not English phrase lists.
 * Uses the same project-task store as the web board. Never wakes Grok Bot.
 */

import { logger } from "@/lib/logger";
import { displayProjectName } from "@/lib/project-tasks/keys";
import { formatRemainingTaskLines } from "@/lib/project-tasks/format";
import {
  addProjectTask,
  completeProjectTask,
  listProjectTasks,
} from "@/lib/project-tasks/store";
import { resolveRegiProjectKey } from "./scope";
import type { SlackRosterLookupResult } from "./types";

export const PIPER_COMMAND_USAGE = [
  "Piper Regi commands (preferred team path):",
  "• `/piper tasks` — your open Regi tasks",
  "• `/piper add <title>` — create a Regi task assigned to you",
  "• `/piper done <number>` — mark that task done",
  "",
  "Numbers match the Regi remaining list (`/piper tasks` and the web board).",
].join("\n");

export type SlackCommandVerb = "list" | "add" | "done" | "help" | "unknown";

export type SlackCommandKind =
  | "command_list"
  | "command_add"
  | "command_done"
  | "command_help";

export interface ParsedPiperCommand {
  verb: SlackCommandVerb;
  title?: string;
  number?: number;
  raw: string;
}

export interface SlackCommandResult {
  kind: SlackCommandKind;
  text: string;
  task?: {
    id: string;
    number: number;
    title: string;
    created: boolean;
  };
}

const LIST_VERBS = new Set(["tasks", "list"]);
const ADD_VERBS = new Set(["add"]);
const DONE_VERBS = new Set(["done"]);
const HELP_VERBS = new Set(["help", "?"]);

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}

export function parseDoneNumber(raw: string): number | undefined {
  const match = raw.trim().match(/#?(\d+)/);
  if (!match) return undefined;
  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseVerbAndRest(text: string): { verb: string; rest: string } {
  const trimmed = text.trim();
  if (!trimmed) return { verb: "", rest: "" };
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  return {
    verb: (match?.[1] ?? "").toLowerCase(),
    rest: (match?.[2] ?? "").trim(),
  };
}

/** Parse `/piper` text or a mention body after @Piper is stripped. */
export function parsePiperCommand(text: string): ParsedPiperCommand {
  const raw = text.trim();
  const withoutSlash = raw.replace(/^\/piper(?:-regi)?\b\s*/i, "").trim();
  const { verb, rest } = parseVerbAndRest(withoutSlash);

  if (!verb || HELP_VERBS.has(verb)) {
    return { verb: "help", raw };
  }
  if (LIST_VERBS.has(verb)) {
    return { verb: "list", raw };
  }
  if (ADD_VERBS.has(verb)) {
    return { verb: "add", title: rest, raw };
  }
  if (DONE_VERBS.has(verb)) {
    return { verb: "done", number: parseDoneNumber(rest), raw };
  }
  return { verb: "unknown", raw };
}

/**
 * Slash Commands can be one `/piper` command or split `/piper-tasks` etc.
 */
export function parseSlackSlashPayload(
  command: string,
  text: string,
): ParsedPiperCommand {
  const cmd = command.trim().toLowerCase().replace(/^\//, "");
  const body = text.trim();

  if (cmd === "piper-tasks" || cmd === "piper-list") {
    return { verb: "list", raw: body };
  }
  if (cmd === "piper-add") {
    return { verb: "add", title: body, raw: body };
  }
  if (cmd === "piper-done") {
    return { verb: "done", number: parseDoneNumber(body), raw: body };
  }

  return parsePiperCommand(body);
}

export function isStructuredPiperCommand(parsed: ParsedPiperCommand): boolean {
  return parsed.verb !== "unknown";
}

function formatAssigneeTaskList(
  name: string,
  projectName: string,
  tasks: Array<{ number: number; title: string }>,
): string {
  if (!tasks.length) {
    return [
      `No open ${projectName} tasks assigned to ${name}.`,
      "Add one: `/piper add <title>`",
    ].join("\n");
  }
  return [
    `Open ${projectName} tasks assigned to ${name}:`,
    "",
    ...formatRemainingTaskLines(tasks),
    "",
    "Mark one done: `/piper done <number>`",
  ].join("\n");
}

async function taskNumberForId(
  projectKey: string,
  taskId: string,
): Promise<number> {
  const numbered = await listProjectTasks({
    project: projectKey,
    includeDone: true,
  });
  return numbered.find((task) => task.id === taskId)?.number ?? 0;
}

async function addAssignedRegiTask(input: {
  projectKey: string;
  title: string;
  userId: string;
  channelId?: string;
}): Promise<{ id: string; title: string; number: number }> {
  const description = input.channelId
    ? `[Slack command ${input.channelId}]`
    : "[Slack command]";

  try {
    const created = await addProjectTask({
      project: input.projectKey,
      title: input.title,
      description,
      source: "slack",
      createdByUserId: input.userId,
      assigneeUserId: input.userId,
    });
    return {
      id: created.id,
      title: created.title,
      number: await taskNumberForId(input.projectKey, created.id),
    };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const fallbackTitle = `${input.title} (${new Date().toISOString().slice(11, 19)})`.slice(
      0,
      120,
    );
    const created = await addProjectTask({
      project: input.projectKey,
      title: fallbackTitle,
      description,
      source: "slack",
      createdByUserId: input.userId,
      assigneeUserId: input.userId,
    });
    return {
      id: created.id,
      title: created.title,
      number: await taskNumberForId(input.projectKey, created.id),
    };
  }
}

export async function processPiperCommand(input: {
  parsed: ParsedPiperCommand;
  roster: Extract<SlackRosterLookupResult, { found: true }>;
  channelId?: string;
}): Promise<SlackCommandResult> {
  const { parsed, roster } = input;

  if (parsed.verb === "help") {
    return { kind: "command_help", text: PIPER_COMMAND_USAGE };
  }

  try {
    const projectKey = resolveRegiProjectKey();
    const projectName = displayProjectName(projectKey);

    if (parsed.verb === "list") {
      const remaining = await listProjectTasks({ project: projectKey });
      const mine = remaining.filter(
        (task) => task.assigneeUserId === roster.user.id,
      );
      return {
        kind: "command_list",
        text: formatAssigneeTaskList(roster.user.name, projectName, mine),
      };
    }

    if (parsed.verb === "add") {
      const title = parsed.title?.trim() ?? "";
      if (!title) {
        return {
          kind: "command_help",
          text: "Usage: `/piper add <title>`",
        };
      }
      const created = await addAssignedRegiTask({
        projectKey,
        title,
        userId: roster.user.id,
        channelId: input.channelId,
      });
      logger.info("slack_command_add", {
        userId: roster.user.id,
        taskNumber: created.number,
        title: created.title,
      });
      return {
        kind: "command_add",
        text: `Got it — logged on Regi as “${created.title}” (task #${created.number}).`,
        task: {
          id: created.id,
          number: created.number,
          title: created.title,
          created: true,
        },
      };
    }

    if (parsed.verb === "done") {
      if (!parsed.number) {
        return {
          kind: "command_help",
          text: "Usage: `/piper done <number>` — numbers from `/piper tasks`.",
        };
      }
      const remaining = await listProjectTasks({ project: projectKey });
      const match = remaining.find((task) => task.number === parsed.number);
      if (!match) {
        return {
          kind: "command_help",
          text: `No open Regi task #${parsed.number}. Use \`/piper tasks\` to see your numbers.`,
        };
      }
      if (match.assigneeUserId !== roster.user.id) {
        return {
          kind: "command_help",
          text: `Task #${parsed.number} isn’t assigned to you. Use \`/piper tasks\` for your numbers.`,
        };
      }
      const completed = await completeProjectTask({
        project: projectKey,
        number: parsed.number,
      });
      logger.info("slack_command_done", {
        userId: roster.user.id,
        taskNumber: completed.number,
        title: completed.title,
      });
      return {
        kind: "command_done",
        text: `Marked Regi task #${completed.number} done: “${completed.title}”.`,
        task: {
          id: completed.id,
          number: completed.number,
          title: completed.title,
          created: false,
        },
      };
    }
  } catch (error) {
    logger.error("slack_command_failed", {
      verb: parsed.verb,
      error: error instanceof Error ? error.message : "unknown",
    });
    return {
      kind: "command_help",
      text: "Couldn't update the Regi board just now. Try again or use the web board.",
    };
  }

  return { kind: "command_help", text: PIPER_COMMAND_USAGE };
}
