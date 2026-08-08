import type OpenAI from "openai";
import { isMicrosoftConfigured } from "@/lib/microsoft/config";

type FunctionTool = OpenAI.Responses.FunctionTool;

function fn(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): FunctionTool {
  return {
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      additionalProperties: false,
      ...parameters,
    },
    strict: false,
  };
}

export function getMicrosoftToolDefinitions(): FunctionTool[] {
  if (!isMicrosoftConfigured()) return [];

  return [
    fn(
      "list_inbox_messages",
      "Index-only list of Outlook messages (subject/preview/ids). NOT enough for a digest. For summaries use brief_inbox instead.",
      {
        properties: {
          unreadOnly: { type: "boolean", description: "If true, only unread messages." },
          top: { type: "number", description: "Page size (1-100). Default 50." },
          maxItems: {
            type: "number",
            description: "Max messages to return across pages (1-500). Default matches top.",
          },
          search: { type: "string", description: "Optional Graph $search string." },
        },
      },
    ),
    fn(
      "brief_inbox",
      "PREFERRED for inbox digests/summaries. Triages unread by header/preview first: high-confidence marketing/spam is auto-marked read (autoCleared) without fetching bodies; only likely-real mail returns cleaned textBody. Always use this instead of list_inbox_messages when Derek asks what his email says or wants a summary.",
      {
        properties: {
          unreadOnly: {
            type: "boolean",
            description: "Defaults to true.",
          },
          top: {
            type: "number",
            description:
              "How many likely-real emails to fully read (1-12). Default 8. Noise is cleared separately and does not count against this.",
          },
          search: { type: "string" },
          autoClearNoise: {
            type: "boolean",
            description:
              "If true (default), mark high-confidence marketing/spam read after header triage.",
          },
        },
      },
    ),
    fn(
      "get_email",
      "Read one Outlook email and return cleaned textBody plus key links. Use for a specific message after brief_inbox/list.",
      {
        properties: {
          messageId: { type: "string" },
        },
        required: ["messageId"],
      },
    ),
    fn(
      "get_emails",
      "Read multiple Outlook emails (max 15) and return cleaned textBody for each.",
      {
        properties: {
          messageIds: { type: "array", items: { type: "string" } },
        },
        required: ["messageIds"],
      },
    ),
    fn("mark_email_read", "Mark one Outlook email read/unread.", {
      properties: {
        messageId: { type: "string" },
        isRead: { type: "boolean" },
      },
      required: ["messageId"],
    }),
    fn("mark_emails_read", "Mark multiple Outlook emails as read by id (max 200).", {
      properties: {
        messageIds: { type: "array", items: { type: "string" } },
      },
      required: ["messageIds"],
    }),
    fn(
      "mark_matching_emails_read",
      "Preferred for one-time bulk cleanup of existing mail. Find matching emails server-side (with pagination) and mark them read. Example: fromContains=github.com, unreadOnly=true, max=200.",
      {
        properties: {
          unreadOnly: {
            type: "boolean",
            description: "Defaults to true.",
          },
          fromContains: {
            type: "string",
            description: "Case-insensitive match on from name/address, e.g. github.com",
          },
          subjectContains: {
            type: "string",
            description: "Case-insensitive subject match.",
          },
          search: {
            type: "string",
            description: "Optional Graph $search to narrow candidates before filtering.",
          },
          max: {
            type: "number",
            description: "Max messages to scan/mark (1-500). Default 200.",
          },
        },
      },
    ),
    fn(
      "list_inbox_rules",
      "List Outlook inbox message rules currently configured for Derek.",
      { properties: {} },
    ),
    fn(
      "create_inbox_rule",
      "Create an Outlook inbox rule (ongoing automation). For 'create GitHub folder + move GitHub mail there + mark read': first ensure_mail_folder displayName=GitHub, then create_inbox_rule with senderContains=['github.com'] or fromAddresses=['notifications@github.com'], moveToFolder=<folder id>, markAsRead=true.",
      {
        properties: {
          displayName: { type: "string" },
          sequence: { type: "number" },
          isEnabled: { type: "boolean" },
          senderContains: { type: "array", items: { type: "string" } },
          subjectContains: { type: "array", items: { type: "string" } },
          bodyContains: { type: "array", items: { type: "string" } },
          fromAddresses: { type: "array", items: { type: "string" } },
          markAsRead: { type: "boolean" },
          delete: { type: "boolean" },
          moveToFolder: {
            type: "string",
            description: "Destination folder id from ensure_mail_folder/create_mail_folder.",
          },
          forwardTo: { type: "array", items: { type: "string" } },
          stopProcessingRules: { type: "boolean" },
        },
        required: ["displayName"],
      },
    ),
    fn("update_inbox_rule", "Update an existing Outlook inbox rule.", {
      properties: {
        ruleId: { type: "string" },
        displayName: { type: "string" },
        sequence: { type: "number" },
        isEnabled: { type: "boolean" },
        markAsRead: { type: "boolean" },
        delete: { type: "boolean" },
        stopProcessingRules: { type: "boolean" },
      },
      required: ["ruleId"],
    }),
    fn("delete_inbox_rule", "Delete an Outlook inbox rule.", {
      properties: { ruleId: { type: "string" } },
      required: ["ruleId"],
    }),
    fn("send_email", "Send an Outlook email as Derek.", {
      properties: {
        to: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
        subject: { type: "string" },
        body: { type: "string" },
        contentType: { type: "string", enum: ["Text", "HTML"] },
        cc: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
      },
      required: ["to", "subject", "body"],
    }),
    fn(
      "create_email_draft",
      "Create a new Outlook draft (does not send). Prefer this before send_email.",
      {
        properties: {
          to: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          subject: { type: "string" },
          body: { type: "string" },
          contentType: { type: "string", enum: ["Text", "HTML"] },
          cc: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
        },
        required: ["to", "subject", "body"],
      },
    ),
    fn("create_reply_draft", "Create a reply draft for an Outlook message.", {
      properties: {
        messageId: { type: "string" },
        comment: { type: "string" },
      },
      required: ["messageId"],
    }),
    fn("list_mail_attachments", "List attachments on an Outlook message.", {
      properties: { messageId: { type: "string" } },
      required: ["messageId"],
    }),
    fn(
      "get_mail_attachment",
      "Download one Outlook attachment (small text inline, otherwise base64 capped).",
      {
        properties: {
          messageId: { type: "string" },
          attachmentId: { type: "string" },
          maxBytes: { type: "number" },
        },
        required: ["messageId", "attachmentId"],
      },
    ),
    fn("list_mail_folders", "List top-level Outlook mail folders and unread counts.", {
      properties: {},
    }),
    fn(
      "list_child_mail_folders",
      "List child folders under a parent mail folder. parentFolderId defaults to 'inbox'.",
      {
        properties: {
          parentFolderId: {
            type: "string",
            description: "Folder id or well-known name like inbox.",
          },
        },
      },
    ),
    fn(
      "create_mail_folder",
      "Create a mail folder under a parent (default parent is inbox). Returns the new folder id needed for rules that move mail.",
      {
        properties: {
          displayName: { type: "string" },
          parentFolderId: {
            type: "string",
            description: "Defaults to inbox.",
          },
        },
        required: ["displayName"],
      },
    ),
    fn(
      "ensure_mail_folder",
      "Get or create a mail folder by name under a parent (default inbox). Prefer this before creating a move-to-folder rule.",
      {
        properties: {
          displayName: { type: "string" },
          parentFolderId: { type: "string" },
        },
        required: ["displayName"],
      },
    ),
    fn("list_calendar_events", "List Outlook calendar events in a date range (defaults to next 7 days). Times are America/Denver. Always use this for calendar questions — do not guess.", {
      properties: {
        start: { type: "string", description: "ISO start datetime" },
        end: { type: "string", description: "ISO end datetime" },
        top: { type: "number" },
      },
    }),
    fn("get_calendar_event", "Get one calendar event by id.", {
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    }),
    fn("create_calendar_event", "Create a calendar event.", {
      properties: {
        subject: { type: "string" },
        start: { type: "string", description: "Local/ISO datetime without timezone offset preferred" },
        end: { type: "string" },
        timeZone: { type: "string", description: "Default America/Denver" },
        body: { type: "string" },
        location: { type: "string" },
        attendees: { type: "array", items: { type: "string" } },
        isAllDay: { type: "boolean" },
      },
      required: ["subject", "start", "end"],
    }),
    fn("update_calendar_event", "Update a calendar event.", {
      properties: {
        eventId: { type: "string" },
        subject: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        timeZone: { type: "string" },
        body: { type: "string" },
        location: { type: "string" },
      },
      required: ["eventId"],
    }),
    fn("delete_calendar_event", "Delete a calendar event.", {
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    }),
    fn(
      "respond_calendar_event",
      "Accept, decline, or tentatively accept a calendar invitation. Confirm with Derek first.",
      {
        properties: {
          eventId: { type: "string" },
          response: {
            type: "string",
            enum: ["accept", "decline", "tentativelyAccept"],
          },
          comment: { type: "string" },
          sendResponse: {
            type: "boolean",
            description: "Whether to notify the organizer. Default true.",
          },
        },
        required: ["eventId", "response"],
      },
    ),
    fn("list_contacts", "List or search Outlook contacts.", {
      properties: {
        top: { type: "number" },
        search: { type: "string" },
      },
    }),
    fn("list_onedrive_children", "List files/folders in Derek's OneDrive path (root if omitted).", {
      properties: {
        path: {
          type: "string",
          description: "Folder path under OneDrive root, e.g. 'Documents/Projects'. Omit for root.",
        },
        top: { type: "number" },
      },
    }),
    fn("search_onedrive", "Search Derek's OneDrive by name/content keywords.", {
      properties: {
        query: { type: "string" },
        top: { type: "number" },
      },
      required: ["query"],
    }),
    fn("get_onedrive_item", "Get metadata for a OneDrive file or folder by path.", {
      properties: {
        path: {
          type: "string",
          description: "Path under OneDrive root, e.g. 'Documents/notes.txt'.",
        },
      },
      required: ["path"],
    }),
    fn(
      "get_onedrive_file_content",
      "Read a OneDrive file. Returns UTF-8 text for text-like files; small binaries as base64; large/Office files return metadata + webUrl.",
      {
        properties: {
          path: { type: "string" },
          maxBytes: {
            type: "number",
            description: "Max bytes to inline (default 200000, max 1000000).",
          },
        },
        required: ["path"],
      },
    ),
    fn("create_onedrive_folder", "Create a folder in Derek's OneDrive (full path).", {
      properties: {
        path: {
          type: "string",
          description: "Folder path to create, e.g. 'Documents/Dina/Notes'.",
        },
        conflictBehavior: {
          type: "string",
          description: "fail | replace | rename. Default fail.",
        },
      },
      required: ["path"],
    }),
    fn(
      "write_onedrive_file",
      "Create/overwrite a text or binary file on OneDrive. FORBIDDEN for .docx/.xlsx/.pptx — those require create_word_document / create_excel_workbook / create_powerpoint_presentation.",
      {
        properties: {
          path: {
            type: "string",
            description: "File path under OneDrive root, e.g. 'notes.txt'. Not for Office extensions.",
          },
          content: {
            type: "string",
            description: "File body. UTF-8 text by default, or base64 when encoding=base64.",
          },
          contentType: {
            type: "string",
            description: "MIME type. Defaults to text/plain; charset=utf-8.",
          },
          encoding: {
            type: "string",
            description: "utf-8 (default) or base64 for binary uploads.",
          },
          conflictBehavior: {
            type: "string",
            description: "fail | replace | rename. Default replace.",
          },
        },
        required: ["path", "content"],
      },
    ),
    fn(
      "delete_onedrive_item",
      "Delete a OneDrive file or folder by path. Irreversible — confirm with Derek first.",
      {
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    ),
    fn(
      "move_onedrive_item",
      "Move and/or rename a OneDrive file or folder.",
      {
        properties: {
          path: { type: "string", description: "Current path." },
          newPath: {
            type: "string",
            description:
              "Destination path. If newName omitted, last segment is the new name.",
          },
          newName: { type: "string", description: "Optional new filename/folder name." },
        },
        required: ["path"],
      },
    ),
    fn("copy_onedrive_item", "Copy a OneDrive file or folder to a new path.", {
      properties: {
        path: { type: "string", description: "Source path." },
        newPath: { type: "string", description: "Destination path including filename." },
      },
      required: ["path", "newPath"],
    }),
    fn(
      "create_word_document",
      "REQUIRED for Word docs / .docx on Derek's OneDrive. Creates a real .docx. Never use create_sharepoint_note or write_onedrive_file for Word.",
      {
        properties: {
          path: {
            type: "string",
            description: "OneDrive path under My files. Prefer root filename e.g. 'EQ Temple Lesson.docx'. Defaults to <title>.docx at My files root.",
          },
          title: { type: "string" },
          paragraphs: { type: "array", items: { type: "string" } },
          blocks: {
            type: "array",
            description: "Optional richer blocks: {type:'paragraph'|'heading', text, level?}",
            items: { type: "object" },
          },
          conflictBehavior: { type: "string", description: "fail | replace | rename" },
        },
      },
    ),
    fn(
      "create_excel_workbook",
      "REQUIRED for Excel / .xlsx on Derek's OneDrive. Never use create_sharepoint_note or write_onedrive_file for Excel.",
      {
        properties: {
          path: { type: "string" },
          title: { type: "string" },
          sheets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                rows: {
                  type: "array",
                  items: { type: "array", items: {} },
                },
              },
            },
          },
          conflictBehavior: { type: "string" },
        },
        required: ["sheets"],
      },
    ),
    fn(
      "create_powerpoint_presentation",
      "REQUIRED for PowerPoint / .pptx on Derek's OneDrive. Never use create_sharepoint_note or write_onedrive_file for PowerPoint.",
      {
        properties: {
          path: { type: "string" },
          title: { type: "string" },
          slides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                notes: { type: "string" },
              },
            },
          },
          conflictBehavior: { type: "string" },
        },
        required: ["slides"],
      },
    ),
    fn("read_word_document", "Extract text from a Word (.docx) file on OneDrive.", {
      properties: { path: { type: "string" } },
      required: ["path"],
    }),
    fn("read_excel_workbook", "Read rows from an Excel (.xlsx) workbook on OneDrive.", {
      properties: {
        path: { type: "string" },
        maxRowsPerSheet: { type: "number" },
        maxSheets: { type: "number" },
      },
      required: ["path"],
    }),
    fn(
      "read_powerpoint_presentation",
      "Extract slide text from a PowerPoint (.pptx) on OneDrive.",
      {
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    ),
    fn(
      "create_sharepoint_note",
      "Create a plain .txt note in the configured SharePoint library only. NOT for Word/Excel/PowerPoint and NOT for OneDrive — use create_word_document / create_excel_workbook / create_powerpoint_presentation / write_onedrive_file instead.",
      {
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          folder: { type: "string" },
        },
        required: ["title", "content"],
      },
    ),
    fn(
      "list_sharepoint_folder",
      "List files/folders in the 4SL Tech Projects SharePoint document library. Use for documents only — not for SharePoint Lists like Network Info.",
      {
        properties: {
          folder: {
            type: "string",
            description:
              "Folder path under Documents, e.g. 'Dev Docs' or 'Systems'. Use '.' for root.",
          },
          top: { type: "number" },
        },
      },
    ),
    fn(
      "list_sharepoint_lists",
      "List SharePoint Lists on the 4SL Tech Projects site (e.g. Network Info, 4SL Contacts). ONLY when Derek explicitly says SharePoint list or names one of those lists. Never use for remembered/chat-built lists — those go to Memory (remember/search_memory).",
      {
        properties: { top: { type: "number" } },
      },
    ),
    fn(
      "get_sharepoint_list_items",
      "Get rows from a SharePoint List by listName (e.g. 'Network Info') or listId. ONLY for explicit SharePoint List requests — not for Memory lists, lesson outlines, or 'remember this for later'.",
      {
        properties: {
          listName: { type: "string" },
          listId: { type: "string" },
          search: { type: "string" },
          top: { type: "number" },
        },
      },
    ),
    fn(
      "list_planner_plans",
      "List Microsoft Planner plans from Derek's M365 groups (e.g. 4SL Tech Projects). Call this first for any Planner question.",
      {
        properties: { top: { type: "number" } },
      },
    ),
    fn("list_planner_tasks", "List tasks in a Planner plan (use planId from list_planner_plans).", {
      properties: {
        planId: { type: "string" },
        top: { type: "number" },
      },
      required: ["planId"],
    }),
    fn(
      "list_my_planner_tasks",
      "List Planner tasks assigned specifically to Derek (may be a subset of plan boards).",
      {
        properties: { top: { type: "number" } },
      },
    ),
    fn("list_planner_buckets", "List buckets in a Planner plan.", {
      properties: { planId: { type: "string" } },
      required: ["planId"],
    }),
    fn("create_planner_task", "Create a Planner task.", {
      properties: {
        planId: { type: "string" },
        title: { type: "string" },
        bucketId: { type: "string" },
        dueDateTime: { type: "string" },
        assignments: {
          type: "array",
          items: { type: "string" },
          description: "Azure AD user IDs to assign",
        },
      },
      required: ["planId", "title"],
    }),
    fn("update_planner_task", "Update a Planner task. Requires current etag (@odata.etag).", {
      properties: {
        taskId: { type: "string" },
        etag: { type: "string" },
        title: { type: "string" },
        percentComplete: { type: "number" },
        dueDateTime: { type: ["string", "null"] },
        bucketId: { type: "string" },
      },
      required: ["taskId", "etag"],
    }),
    fn("get_planner_task", "Get a Planner task plus description/checklist details.", {
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    }),
    fn("delete_planner_task", "Delete a Planner task. Requires etag. Confirm with Derek first.", {
      properties: {
        taskId: { type: "string" },
        etag: { type: "string" },
      },
      required: ["taskId", "etag"],
    }),
    fn(
      "set_planner_task_details",
      "Set Planner task description and/or replace checklist. Requires detailsEtag from get_planner_task.",
      {
        properties: {
          taskId: { type: "string" },
          detailsEtag: { type: "string" },
          description: { type: "string" },
          checklist: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                isChecked: { type: "boolean" },
              },
            },
          },
        },
        required: ["taskId", "detailsEtag"],
      },
    ),
    fn("list_todo_lists", "List Microsoft To Do lists.", { properties: {} }),
    fn("list_todo_tasks", "List incomplete tasks in a To Do list.", {
      properties: {
        listId: { type: "string" },
        top: { type: "number" },
      },
      required: ["listId"],
    }),
    fn("create_todo_task", "Create a Microsoft To Do task.", {
      properties: {
        listId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        dueDateTime: { type: "string" },
        timeZone: { type: "string" },
      },
      required: ["listId", "title"],
    }),
    fn("list_joined_teams", "List Teams Derek has joined (requires app permissions).", {
      properties: {},
    }),
    fn("list_team_channels", "List channels in a Team.", {
      properties: { teamId: { type: "string" } },
      required: ["teamId"],
    }),
    fn(
      "list_channel_messages",
      "List recent messages in a Teams channel (not 1:1 chats — those need delegated auth).",
      {
        properties: {
          teamId: { type: "string" },
          channelId: { type: "string" },
          top: { type: "number" },
        },
        required: ["teamId", "channelId"],
      },
    ),
    fn("send_channel_message", "Send a message to a Teams channel. Confirm with Derek first.", {
      properties: {
        teamId: { type: "string" },
        channelId: { type: "string" },
        message: { type: "string" },
      },
      required: ["teamId", "channelId", "message"],
    }),
    fn("reply_channel_message", "Reply in a Teams channel thread. Confirm with Derek first.", {
      properties: {
        teamId: { type: "string" },
        channelId: { type: "string" },
        messageId: { type: "string" },
        message: { type: "string" },
      },
      required: ["teamId", "channelId", "messageId", "message"],
    }),
  ];
}
