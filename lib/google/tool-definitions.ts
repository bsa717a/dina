import type OpenAI from "openai";
import { isGoogleConfigured } from "@/lib/google/config";
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

export function getGoogleToolDefinitions(): FunctionTool[] {
  const tools: FunctionTool[] = [];

  // Always available when either mail provider is configured — helps Dina juggle.
  if (isMicrosoftConfigured() || isGoogleConfigured()) {
    tools.push(
      fn(
        "list_mail_accounts",
        "List configured mail/calendar accounts (Microsoft 365 work vs Google personal). Call first when Derek's request does not specify which inbox/calendar.",
        { properties: {} },
      ),
      fn(
        "block_attention_sender",
        "Block a sender email or @domain from future Attention scans (both work and personal). Does not delete mail. Example: user@example.com or @newsletters.com",
        {
          properties: {
            target: {
              type: "string",
              description: "Email address or @domain to block from Attention.",
            },
            reason: { type: "string" },
          },
          required: ["target"],
        },
      ),
      fn(
        "unblock_attention_sender",
        "Remove a sender or @domain from the Attention blocklist.",
        {
          properties: {
            target: { type: "string" },
          },
          required: ["target"],
        },
      ),
      fn("list_attention_blocks", "List durable Attention sender/domain blocks.", {
        properties: {},
      }),
    );
  }

  if (!isGoogleConfigured()) return tools;

  tools.push(
    fn(
      "gmail_brief_inbox",
      "PREFERRED for PERSONAL Gmail digests (not Outlook). Triages unread by header/labels first: promotions/spam/marketing auto-marked read (autoCleared); returns textBody for likely-real mail. Always name this as Personal/Gmail when summarizing.",
      {
        properties: {
          top: {
            type: "number",
            description:
              "How many likely-real emails to fully read (1-12). Default 8.",
          },
          autoClearNoise: {
            type: "boolean",
            description:
              "If true (default), mark high-confidence marketing/spam read after triage.",
          },
          query: {
            type: "string",
            description:
              "Optional Gmail search query appended to is:unread -in:spam -in:trash.",
          },
        },
      },
    ),
    fn(
      "gmail_list_messages",
      "Index-only list of PERSONAL Gmail messages (subject/snippet/ids). For digests use gmail_brief_inbox.",
      {
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
        },
      },
    ),
    fn(
      "gmail_get_email",
      "Read one PERSONAL Gmail message and return cleaned textBody. Pass the FULL emails[].id from gmail_brief_inbox (never truncate).",
      {
        properties: {
          messageId: {
            type: "string",
            description: "Full Gmail message id from gmail_brief_inbox emails[].id",
          },
        },
        required: ["messageId"],
      },
    ),
    fn(
      "gmail_mark_read",
      "Mark one PERSONAL Gmail message read/unread. Pass the FULL emails[].id from gmail_brief_inbox.",
      {
        properties: {
          messageId: {
            type: "string",
            description: "Full Gmail message id from gmail_brief_inbox emails[].id",
          },
          isRead: { type: "boolean" },
        },
        required: ["messageId"],
      },
    ),
    fn(
      "gmail_send_email",
      "Send email from PERSONAL Gmail. Ask Derek before sending. Always confirm this is the personal account, not work Outlook.",
      {
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    ),
    fn("gmail_create_draft", "Create a draft in PERSONAL Gmail (does not send).", {
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    }),
    fn(
      "gmail_create_reply_draft",
      "Create a reply draft on a PERSONAL Gmail thread (does not send).",
      {
        properties: {
          messageId: { type: "string" },
          body: { type: "string" },
          subject: { type: "string" },
        },
        required: ["messageId", "body"],
      },
    ),
    fn("gmail_list_labels", "List PERSONAL Gmail labels.", { properties: {} }),
    fn(
      "google_list_calendar_events",
      "List events from PERSONAL Google Calendar (not Outlook). Always label results as Personal/Google.",
      {
        properties: {
          timeMin: { type: "string", description: "ISO start (default now)." },
          timeMax: {
            type: "string",
            description: "ISO end (default +14 days).",
          },
          maxResults: { type: "number" },
          q: { type: "string" },
        },
      },
    ),
    fn("google_get_calendar_event", "Get one PERSONAL Google Calendar event.", {
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    }),
    fn("google_create_calendar_event", "Create an event on PERSONAL Google Calendar.", {
      properties: {
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: { type: "string", description: "ISO dateTime or YYYY-MM-DD" },
        end: { type: "string", description: "ISO dateTime or YYYY-MM-DD" },
        attendees: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "start", "end"],
    }),
    fn("google_update_calendar_event", "Update a PERSONAL Google Calendar event.", {
      properties: {
        eventId: { type: "string" },
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
      },
      required: ["eventId"],
    }),
    fn("google_delete_calendar_event", "Delete a PERSONAL Google Calendar event.", {
      properties: { eventId: { type: "string" } },
      required: ["eventId"],
    }),
    fn(
      "google_respond_calendar_event",
      "Accept/decline/tentative a PERSONAL Google Calendar invitation.",
      {
        properties: {
          eventId: { type: "string" },
          response: {
            type: "string",
            enum: ["accepted", "declined", "tentative"],
          },
        },
        required: ["eventId", "response"],
      },
    ),
  );

  return tools;
}
