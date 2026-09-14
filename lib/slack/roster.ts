/**
 * Slack roster lookup: Slack user id → Piper teammate.
 *
 * Looks up User.slackUserId first, then optional SLACK_USER_MAP
 * (slackUserId:username). Does NOT auto-provision unknown users.
 */

import { prisma } from "@/lib/db/client";
import { findUserByUsername } from "@/lib/auth/users";
import { toAuthUser } from "@/lib/auth/types";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";
import { getSlackUserMap } from "@/lib/env";
import { resolveRegiProjectKey } from "./scope";
import type { SlackRosterLookupResult } from "./types";

const SLACK_USER_ID_RE = /^U[A-Z0-9]+$/i;

export function normalizeSlackUserId(raw: string): string {
  return raw.trim();
}

export function isValidSlackUserId(raw: string): boolean {
  return SLACK_USER_ID_RE.test(raw.trim());
}

export async function lookupBySlackUserId(
  rawSlackUserId: string,
): Promise<SlackRosterLookupResult> {
  const slackUserId = normalizeSlackUserId(rawSlackUserId);
  if (!isValidSlackUserId(slackUserId)) {
    return { found: false, slackUserId, reason: "unknown_user" };
  }

  let row = await prisma.user.findUnique({
    where: { slackUserId },
  });

  if (!row) {
    const mappedUsername = getSlackUserMap()[slackUserId];
    if (mappedUsername) {
      const mapped = await findUserByUsername(mappedUsername);
      if (mapped) {
        row = await prisma.user.findUnique({ where: { id: mapped.id } });
      }
    }
  }

  if (!row) {
    return { found: false, slackUserId, reason: "unknown_user" };
  }

  const user = toAuthUser(row);
  const memberKeys = await listMemberProjectKeys(user);
  const regiKey = resolveRegiProjectKey();
  const onRegiProject = user.role === "owner" || memberKeys.includes(regiKey);

  return {
    found: true,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      slackUserId,
    },
    authUser: user,
    projectKeys: onRegiProject ? [regiKey] : memberKeys,
    onRegiProject,
  };
}

export async function linkSlackUser(
  username: string,
  slackUserId: string,
): Promise<{ id: string; username: string; slackUserId: string }> {
  const normalized = normalizeSlackUserId(slackUserId);
  if (!isValidSlackUserId(normalized)) {
    throw new Error(`Invalid Slack user id: "${slackUserId}". Expected U…`);
  }

  const existing = await findUserByUsername(username);
  if (!existing) {
    throw new Error(`No Piper user found for username "${username}".`);
  }

  const taken = await prisma.user.findUnique({
    where: { slackUserId: normalized },
  });
  if (taken && taken.id !== existing.id) {
    throw new Error(
      `Slack user ${normalized} is already linked to @${taken.username}.`,
    );
  }

  const row = await prisma.user.update({
    where: { id: existing.id },
    data: { slackUserId: normalized },
  });

  return {
    id: row.id,
    username: row.username,
    slackUserId: normalized,
  };
}
