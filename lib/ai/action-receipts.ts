/**
 * Prevent false "I did it" claims: mutating tool outputs get an explicit
 * receipt instruction the model must follow before reporting completion.
 */

/** Tools that change external or durable state (not pure reads). */
export const MUTATING_TOOLS = new Set([
  // Memory / stars / project tasks
  "remember",
  "correct_memory",
  "approve_memory",
  "archive_memory",
  "merge_memories",
  "unstar_message",
  "add_project_task",
  "complete_project_task",
  "update_project_task",
  // Microsoft mail / calendar / files
  "send_email",
  "create_email_draft",
  "create_reply_draft",
  "mark_email_read",
  "mark_emails_read",
  "mark_matching_emails_read",
  "ensure_mail_folder",
  "create_mail_folder",
  "create_inbox_rule",
  "update_inbox_rule",
  "delete_inbox_rule",
  "respond_calendar_event",
  "create_calendar_event",
  "update_calendar_event",
  "delete_calendar_event",
  "write_onedrive_file",
  "create_onedrive_folder",
  "delete_onedrive_item",
  "move_onedrive_item",
  "copy_onedrive_item",
  "create_word_document",
  "create_excel_workbook",
  "create_powerpoint_presentation",
  "create_sharepoint_note",
  "create_planner_task",
  "update_planner_task",
  "set_planner_task_details",
  "delete_planner_task",
  "create_todo_task",
  "send_channel_message",
  "reply_channel_message",
  "block_attention_sender",
  "unblock_attention_sender",
  // Google
  "gmail_send_email",
  "gmail_mark_read",
  "gmail_create_draft",
  "google_create_calendar_event",
  "google_update_calendar_event",
  "google_delete_calendar_event",
  // GitHub (writes if any exist — keep names defensive)
  "create_github_issue",
  "comment_on_github_issue",
  "create_github_pr_review",
]);

const SUCCESS_INSTRUCTION =
  "ACTION RECEIPT: This mutating tool SUCCEEDED (ok=true). You may tell Derek it is done ONLY using facts in this payload (paths, ids, counts, links). Do not invent extra outcomes.";

const UNCONFIRMED_INSTRUCTION =
  "ACTION RECEIPT: This mutating tool returned ok=true but verified=false (queued or verify-read incomplete). Do NOT tell Derek the action is finished. Say it is not confirmed yet and offer to re-check.";

const FAILURE_INSTRUCTION =
  "ACTION RECEIPT: This mutating tool FAILED (ok=false). Do NOT claim the action succeeded. Report the error honestly. Do not invent a path, link, or completion.";

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

function verifiedFlag(parsed: {
  verified?: boolean;
  data?: { verified?: boolean };
}): boolean | undefined {
  if (typeof parsed.data?.verified === "boolean") return parsed.data.verified;
  if (typeof parsed.verified === "boolean") return parsed.verified;
  return undefined;
}

/**
 * Attach a receipt instruction to mutating tool JSON so the model cannot
 * treat intent / prior chat as proof of completion.
 */
export function annotateToolOutput(name: string, output: string): string {
  if (!isMutatingTool(name)) return output;

  try {
    const parsed = JSON.parse(output) as {
      ok?: boolean;
      verified?: boolean;
      instruction?: string;
      data?: { verified?: boolean };
    };
    let instruction = FAILURE_INSTRUCTION;
    if (parsed.ok === true) {
      instruction =
        verifiedFlag(parsed) === false
          ? UNCONFIRMED_INSTRUCTION
          : SUCCESS_INSTRUCTION;
    }
    // Keep any tool-specific instruction; put receipt first.
    const merged = parsed.instruction
      ? `${instruction} ${parsed.instruction}`
      : instruction;
    return JSON.stringify({ ...parsed, instruction: merged });
  } catch {
    return JSON.stringify({
      ok: false,
      error: "Tool returned non-JSON output.",
      raw: output.slice(0, 500),
      instruction: FAILURE_INSTRUCTION,
    });
  }
}
