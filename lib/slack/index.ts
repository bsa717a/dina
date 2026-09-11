/**
 * Slack ↔ Piper integration (Regi project only).
 *
 * Provides:
 * - Events API signature verification
 * - Socket Mode inbound (preferred when SLACK_APP_TOKEN is set)
 * - Roster lookup (Slack user → teammate)
 * - Regi task + Attention ledger
 * - Grok Bot Dina handoff (same pattern as Telnyx)
 * - Threaded Slack replies
 */

export * from "./types";
export * from "./config";
export * from "./verify";
export * from "./scope";
export * from "./roster";
export * from "./client";
export * from "./handoff";
export * from "./ledger";
export * from "./process";
export * from "./dedupe";
export * from "./ingest";
export * from "./socket-status";
export * from "./socket";
