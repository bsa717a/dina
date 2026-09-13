/**
 * Slack ↔ Piper integration (Regi project only).
 *
 * Provides:
 * - Events API signature verification
 * - Roster lookup (Slack user → teammate)
 * - Regi task + Attention ledger
 * - Grok Bot Dina handoff (same pattern as Telnyx)
 * - Threaded Slack replies
 */

export * from "./types";
export * from "./config";
export * from "./verify";
export * from "./dedupe";
export * from "./scope";
export * from "./roster";
export * from "./client";
export * from "./handoff";
export * from "./ledger";
export * from "./process";
