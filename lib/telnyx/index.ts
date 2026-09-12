/**
 * Telnyx RCS/SMS integration module.
 *
 * Provides:
 * - Inbound webhook processing with signature verification
 * - Roster lookup (phone → teammate/project)
 * - Grok Bot Dina handoff
 * - Outbound RCS (POST /v2/messages/rcs) and explicit SMS fallback
 */

export * from "./types";
export * from "./config";
export * from "./verify";
export * from "./roster";
export * from "./client";
export * from "./handoff";
export * from "./inbound";
export * from "./keywords";
