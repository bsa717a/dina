/**
 * Extension points for Dina capabilities.
 * Microsoft 365 is implemented via lib/microsoft/* and registered through ToolRegistry.
 */

import { isGitHubConfigured } from "@/lib/github/config";
import { listGitHubToolNames } from "@/lib/github/tools";
import { listGoogleToolNames } from "@/lib/google/tools";
import { isMicrosoftConfigured } from "@/lib/microsoft/config";
import { listMicrosoftToolNames } from "@/lib/microsoft/tools";

export interface EmailProvider {
  send?(input: { to: string; subject: string; body: string }): Promise<void>;
  listRecent?(): Promise<unknown[]>;
}

export interface CalendarProvider {
  listEvents?(range: { from: Date; to: Date }): Promise<unknown[]>;
}

export interface NotesProvider {
  search?(query: string): Promise<unknown[]>;
}

export interface ReminderProvider {
  create?(title: string): Promise<unknown>;
}

export interface ToolRegistry {
  listTools(): string[];
}

export const extensions = {
  email: null as EmailProvider | null,
  calendar: null as CalendarProvider | null,
  notes: null as NotesProvider | null,
  reminders: null as ReminderProvider | null,
  tools: {
    listTools() {
      return [
        ...(isMicrosoftConfigured() ? listMicrosoftToolNames() : []),
        ...listGoogleToolNames(),
        ...(isGitHubConfigured() ? listGitHubToolNames() : []),
      ];
    },
  } satisfies ToolRegistry,
};
