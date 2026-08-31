/**
 * Telnyx RCS/SMS integration module.
 *
 * Provides:
 * - Inbound webhook processing with signature verification
 * - Roster lookup (phone → teammate/project)
 * - Grok Bot Dina handoff
 * - Outbound RCS/SMS sending with RCS-first fallback
 */

export * from "./types";
export * from "./config";
export * from "./verify";
export * from "./roster";
export * from "./client";
export * from "./handoff";
