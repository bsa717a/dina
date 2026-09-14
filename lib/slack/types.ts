/**
 * Slack Events API types for the Regi-only Piper bot.
 */

import type { AuthUser } from "@/lib/auth/types";

export type SlackEventType = "url_verification" | "event_callback";

export type SlackInnerEventType = "app_mention" | "message";

export type SlackChannelType = "channel" | "group" | "im" | "mpim";

export interface SlackUrlVerification {
  type: "url_verification";
  challenge: string;
  token?: string;
}

export interface SlackEventCallback {
  type: "event_callback";
  token?: string;
  team_id?: string;
  api_app_id?: string;
  event: SlackInnerEvent;
  event_id?: string;
  event_time?: number;
}

export interface SlackInnerEvent {
  type: SlackInnerEventType | string;
  user?: string;
  text?: string;
  ts?: string;
  event_ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: SlackChannelType | string;
  bot_id?: string;
  subtype?: string;
  team?: string;
}

export type SlackWebhookPayload = SlackUrlVerification | SlackEventCallback | Record<string, unknown>;

export interface SlackInboundEvent {
  type: SlackInnerEventType;
  slackUserId: string;
  text: string;
  channelId: string;
  ts: string;
  threadTs: string;
  channelType?: string;
  botId?: string;
  subtype?: string;
  teamId?: string;
  eventId?: string;
}

export type SlackRosterLookupResult =
  | {
      found: true;
      user: {
        id: string;
        name: string;
        username: string;
        slackUserId: string;
      };
      /** Full Piper actor — same AuthUser the web chat session uses. */
      authUser: AuthUser;
      projectKeys: string[];
      onRegiProject: boolean;
    }
  | {
      found: false;
      slackUserId: string;
      reason: "unknown_user";
    };

export interface SlackHandoffPayload {
  messageId: string;
  channel: "slack";
  from: string;
  to: string;
  text: string;
  messageType: "slack";
  receivedAt: string;
  user: {
    id: string;
    name: string;
    username: string;
  } | null;
  /** Always the Regi project key for this bot — never 4SL / Metabolic. */
  projectKeys: string[];
  slack: {
    teamId?: string;
    channelId: string;
    threadTs: string;
    eventTs: string;
    slackUserId: string;
  };
}

export interface SlackInboundResult {
  handled: boolean;
  ignored?: boolean;
  reason?: string;
  reply?: {
    text: string;
    channelId: string;
    threadTs: string;
  };
  task?: {
    id: string;
    number: number;
    title: string;
    created: boolean;
  };
  attention?: {
    id: string;
  };
  handoff?: "sent" | "logged" | "error" | "skipped";
  replyKind?: "chat" | "remaining_tasks" | "assignee_status" | "ack";
  roster?: SlackRosterLookupResult;
}

export interface SlackThreadMeta {
  /** Present only when an older Slack ledger write created a task. */
  taskId?: string;
  channelId: string;
  threadTs: string;
  slackUserId: string;
  projectKey: string;
}

export const UNKNOWN_USER_REPLY =
  "I don't recognize your Slack account in Piper. Ask Derek to add you to the Regi project.";

export const NOT_ON_REGI_REPLY =
  "You're in Piper, but not on the Regi project. Ask Derek to add you to Regi.";

export const SLACK_BLOCKED_PROJECT_KEYS = ["4studentlives", "metabolicos"] as const;
