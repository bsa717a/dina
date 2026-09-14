/**
 * Slack ↔ Piper integration (Regi project only).
 *
 * Provides:
 * - Events API signature verification
 * - Roster lookup (Slack user → teammate)
 * - Regi task + Attention ledger
 * - Local in-thread replies (no Grok Bot wake)
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
export * from "./reply";
export * from "./process";
