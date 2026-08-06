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
      "PREFERRED for inbox digests/summaries. Lists recent/unread mail and returns cleaned textBody for each message in one call. Always use this instead of list_inbox_messages when Derek asks what his email says or wants a summary.",
      {
        properties: {
          unreadOnly: {
            type: "boolean",
            description: "Defaults to true.",
          },
          top: {
            type: "number",
            description: "How many emails to fully read (1-12). Default 8.",
          },
          search: { type: "string" },
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
    fn("create_reply_draft", "Create a reply draft for an Outlook message.", {
      properties: {
        messageId: { type: "string" },
        comment: { type: "string" },
      },
      required: ["messageId"],
    }),
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
    fn("list_calendar_events", "List calendar events in a date range (defaults to next 7 days).", {
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
    fn("list_contacts", "List or search Outlook contacts.", {
      properties: {
        top: { type: "number" },
        search: { type: "string" },
      },
    }),
    fn("list_onedrive_children", "List files/folders in OneDrive path (root if omitted).", {
      properties: {
        path: { type: "string" },
        top: { type: "number" },
      },
    }),
    fn("search_onedrive", "Search Derek's OneDrive.", {
      properties: {
        query: { type: "string" },
        top: { type: "number" },
      },
      required: ["query"],
    }),
    fn("create_sharepoint_note", "Create a text note in the configured SharePoint library/folder.", {
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        folder: { type: "string" },
      },
      required: ["title", "content"],
    }),
    fn("list_sharepoint_folder", "List files in a SharePoint folder.", {
      properties: {
        folder: { type: "string" },
        top: { type: "number" },
      },
    }),
    fn("list_planner_plans", "List Microsoft Planner plans available to Derek.", {
      properties: { top: { type: "number" } },
    }),
    fn("list_planner_tasks", "List tasks in a Planner plan.", {
      properties: {
        planId: { type: "string" },
        top: { type: "number" },
      },
      required: ["planId"],
    }),
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
    fn("send_channel_message", "Send a message to a Teams channel.", {
      properties: {
        teamId: { type: "string" },
        channelId: { type: "string" },
        message: { type: "string" },
      },
      required: ["teamId", "channelId", "message"],
    }),
  ];
}
