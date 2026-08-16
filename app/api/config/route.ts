import { NextResponse } from "next/server";
import { avatarUrlForKey } from "@/lib/assistants/catalog";
import { getSession, requireSession } from "@/lib/auth/session";
import { needsOnboarding } from "@/lib/auth/types";
import { getVapidConfig } from "@/lib/env";
import { unauthorized } from "@/lib/http";
import {
  isGitHubConfigured,
  listGitHubAccountSummaries,
} from "@/lib/github/config";
import { listGitHubToolNames } from "@/lib/github/tools";
import { getGoogleConfig, isGoogleConfigured } from "@/lib/google/config";
import { listGoogleToolNames } from "@/lib/google/tools";
import { getMicrosoftConfig, isMicrosoftConfigured } from "@/lib/microsoft/config";
import { listMicrosoftToolNames } from "@/lib/microsoft/tools";
import { displayProjectName } from "@/lib/project-tasks/keys";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";

export const runtime = "nodejs";

/** Non-secret client config for authenticated sessions. */
export async function GET() {
  const user = await requireSession();
  if (!user) return unauthorized();

  const onboarding = needsOnboarding(user);
  const session = await getSession();
  if (session.needsOnboarding !== onboarding) {
    session.needsOnboarding = onboarding;
    await session.save();
  }

  const vapid = getVapidConfig();
  const isOwner = user.role === "owner";
  const projectKeys = await listMemberProjectKeys(user);
  const ms = isOwner ? getMicrosoftConfig() : null;
  const google = isOwner ? getGoogleConfig() : null;

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      assistantName: user.assistantName,
      assistantKey: user.assistantKey,
      avatarUrl: avatarUrlForKey(user.assistantKey),
      needsOnboarding: onboarding,
    },
    projects: projectKeys.map((key) => ({
      key,
      name: displayProjectName(key),
    })),
    pushEnabled: isOwner && Boolean(vapid),
    vapidPublicKey: isOwner ? vapid?.publicKey ?? null : null,
    microsoftEnabled: isOwner && isMicrosoftConfigured(),
    microsoftUser: isOwner ? ms?.userEmail ?? null : null,
    microsoftTools: isOwner && isMicrosoftConfigured() ? listMicrosoftToolNames() : [],
    googleEnabled: isOwner && isGoogleConfigured(),
    googleUser: isOwner ? google?.userEmail ?? null : null,
    googleLabel: isOwner ? google?.label ?? null : null,
    googleTools: isOwner ? listGoogleToolNames() : [],
    githubEnabled: isOwner && isGitHubConfigured(),
    githubAccounts: isOwner && isGitHubConfigured() ? listGitHubAccountSummaries() : [],
    githubTools: isOwner && isGitHubConfigured() ? listGitHubToolNames() : [],
  });
}
