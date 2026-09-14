/**
 * Slack adapter for the Piper web-chat brain.
 *
 * Maps a rostered Slack user onto runChatTurn with Active project = Regi.
 * Same provider, tools, memory, and conversation as the Piper text box.
 * Must never call Grok Bot / handoffSlackToGrokBot.
 */

import type { AuthUser } from "@/lib/auth/types";
import { resolveActiveProjectForUser } from "@/lib/chat/active-project";
import { runChatTurn } from "@/lib/chat/run-turn";
import { logger } from "@/lib/logger";
import { resolveRegiProjectKey } from "./scope";

export async function runSlackPiperChat(input: {
  user: AuthUser;
  text: string;
}): Promise<{ ok: boolean; text: string }> {
  const projectKey = resolveRegiProjectKey();
  const activeProject = await resolveActiveProjectForUser(input.user, projectKey);
  if (!activeProject) {
    logger.warn("slack_chat_regi_unresolved", {
      userId: input.user.id,
      projectKey,
    });
    return {
      ok: false,
      text: "You're mapped in Piper, but I couldn't scope this turn to Regi.",
    };
  }

  const result = await runChatTurn({
    user: input.user,
    content: input.text,
    attachmentIds: [],
    providerAttachments: [],
    activeProject,
  });

  if (result.ok && result.text.trim()) {
    return { ok: true, text: result.text };
  }

  const fallback =
    result.error ||
    `Something went wrong while talking to ${input.user.assistantName}.`;
  logger.error("slack_chat_turn_failed", {
    userId: input.user.id,
    error: fallback,
    code: result.ok ? undefined : result.code,
  });
  return { ok: false, text: fallback };
}
