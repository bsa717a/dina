import OpenAI from "openai";
import {
  getDefaultTimeZone,
  getOpenAIApiKey,
  getOpenAIChatModel,
} from "@/lib/env";
import { annotateToolOutput } from "@/lib/ai/action-receipts";
import {
  allRequiredDomainsMet,
  domainsSatisfiedByTool,
  evidenceDomainsForQuestion,
  evidenceToolSucceeded,
  looksLikeHonestUncertainty,
  looksLikeUnverifiedLiveClaim,
  type EvidenceDomain,
} from "@/lib/ai/evidence";
import {
  attachChatTurnUsage,
  detachChatTurnUsage,
  emptyUsageTotals,
  recordOpenAIUsage,
} from "@/lib/ai/usage";
import {
  isOpenAICreditsBlocked,
  isOpenAICreditsError,
  markOpenAICreditsExhausted,
  openAICreditsUserMessage,
} from "@/lib/ai/openai-errors";
import {
  formatActiveProjectRuntime,
  getDinaSystemPrompt,
  getMemberSystemPrompt,
} from "@/lib/ai/prompt";
import type {
  ModelProvider,
  ProviderMessage,
  StreamEvent,
  StreamUsage,
} from "@/lib/ai/provider";
import {
  annotateCitationToolOutput,
  churchToolSucceeded,
  isChurchCitationTool,
} from "@/lib/church/citation-receipts";
import { getChurchToolDefinitions } from "@/lib/church/tool-definitions";
import { executeChurchTool, listChurchToolNames } from "@/lib/church/tools";
import { logger } from "@/lib/logger";
import { getGitHubToolDefinitions } from "@/lib/github/tool-definitions";
import { executeGitHubTool, listGitHubToolNames } from "@/lib/github/tools";
import {
  getMemberMemoryToolDefinitions,
  getMemoryToolDefinitions,
} from "@/lib/memory/tool-definitions";
import { executeMemoryTool, listMemoryToolNames } from "@/lib/memory/tools";
import { isGoogleConfigured } from "@/lib/google/config";
import { getGoogleToolDefinitions } from "@/lib/google/tool-definitions";
import { executeGoogleTool, listGoogleToolNames } from "@/lib/google/tools";
import { isMicrosoftConfigured } from "@/lib/microsoft/config";
import { getMicrosoftToolDefinitions } from "@/lib/microsoft/tool-definitions";
import { executeMicrosoftTool, listMicrosoftToolNames } from "@/lib/microsoft/tools";
import {
  formatLessonsForPrompt,
  listActiveLessons,
} from "@/lib/learning/lessons";
import { getProjectTaskToolDefinitions } from "@/lib/project-tasks/tool-definitions";
import {
  executeProjectTaskTool,
  listProjectTaskToolNames,
} from "@/lib/project-tasks/tools";
import { getWritingToolDefinitions } from "@/lib/writing/tool-definitions";
import {
  executeWritingTool,
  listWritingToolNames,
} from "@/lib/writing/tools";
import { getStarToolDefinitions } from "@/lib/stars/tool-definitions";
import { executeStarTool, listStarToolNames } from "@/lib/stars/tools";
import { getTeamToolDefinitions } from "@/lib/team/tool-definitions";
import { executeTeamTool, listTeamToolNames } from "@/lib/team/tools";
import { getMorningRitualToolDefinitions } from "@/lib/morning-ritual/tool-definitions";
import { getMorningBriefPreference } from "@/lib/morning-ritual/preferences";
import { looksLikeSectionSelection } from "@/lib/morning-ritual/sections";
import {
  executeMorningRitualTool,
  extractMorningBriefPresentMarkdown,
  listMorningRitualToolNames,
} from "@/lib/morning-ritual/tools";
import {
  friendlyToolStatus,
  isCalendarQuestion,
  isChurchCitationQuestion,
  isEmailQuestion,
  isGitHubQuestion,
  isMorningBriefRequest,
  isMorningBriefSetupRequest,
  isOneDriveQuestion,
  isPlannerQuestion,
  isSharePointListQuestion,
  isSharePointQuestion,
  isWordDocumentRequest,
  looksLikeStallingFiller,
  looksLikeUnverifiedChurchCitation,
  requiresLiveEvidence,
} from "@/lib/ai/tool-routing";

type EasyInputMessage = OpenAI.Responses.ResponseInputItem;

type FunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

function looksLikeFalseCalendarEmpty(content: string) {
  return (
    /(no (scheduled )?events|calendar.*(empty|open|no scheduled)|not seeing the meeting|issue with the calendar fetch|might need to be added manually)/i.test(
      content,
    ) && !/\b(Breck and Derek|Student Transfer)\b.*\b(3|15:00)\b/i.test(content)
  );
}

function looksLikeFalseMsUnavailable(content: string) {
  return /(can'?t|cannot|don'?t|do not|unable to).{0,40}\b(see|access|open|read)\b.{0,40}\b(planner|share\s*point|sharepoint)\b|\b(planner|sharepoint).{0,40}\b(not (available|configured|connected)|unavailable)\b/i.test(
    content,
  );
}

function denverNowLabel() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getDefaultTimeZone(),
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date());
}

/** How many prior chat turns to send the model. Too small and collaborative lists/docs get lost. */
const CHAT_HISTORY_WINDOW = 80;

function buildInput(messages: ProviderMessage[]): EasyInputMessage[] {
  const input: EasyInputMessage[] = [];
  // Keep recent context; filter junk digests so they don't dominate.
  const recent = messages.slice(-CHAT_HISTORY_WINDOW);

  for (const message of recent) {
    if (message.role === "system") continue;

    if (message.role === "assistant") {
      // Drop prior assistant digests that are just subject+link lists; they reinforce bad behavior.
      const hasOwaLink = /outlook\.office(365)?\.com\/owa/i.test(message.content);
      const looksLikeLazyDigest =
        (/\[Read (Email|More)\]\(/i.test(message.content) || hasOwaLink) &&
        !/(amount|due|action|deadline|\$|invoice|balance)/i.test(message.content);
      if (looksLikeLazyDigest) continue;
      // Drop prior false "calendar empty" / "can't see Planner/SharePoint" answers.
      if (looksLikeFalseCalendarEmpty(message.content)) continue;
      if (looksLikeFalseMsUnavailable(message.content)) continue;

      input.push({
        role: "assistant",
        content: message.content,
      });
      continue;
    }

    const content: OpenAI.Responses.ResponseInputContent[] = [];
    const textParts: string[] = [];
    if (message.content.trim()) textParts.push(message.content.trim());

    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image" && attachment.dataUrl) {
        content.push({
          type: "input_image",
          image_url: attachment.dataUrl,
          detail: "auto",
        });
      } else if (attachment.textContent) {
        textParts.push(
          `[Attachment: ${attachment.filename}]\n${attachment.textContent}`,
        );
      } else {
        textParts.push(
          `[Attachment uploaded: ${attachment.filename} (${attachment.mimeType})]`,
        );
      }
    }

    if (textParts.length) {
      content.unshift({
        type: "input_text",
        text: textParts.join("\n\n"),
      });
    }

    if (!content.length) {
      content.push({ type: "input_text", text: "(empty message)" });
    }

    input.push({
      role: "user",
      content,
    });
  }

  return input;
}

function collectFunctionCalls(output: OpenAI.Responses.ResponseOutputItem[]): FunctionCallItem[] {
  const calls: FunctionCallItem[] = [];
  for (const item of output) {
    if (item.type === "function_call") {
      calls.push({
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }
  return calls;
}

function buildInstructions(
  msConfigured: boolean,
  googleConfigured: boolean,
  msCount: number,
  googleCount: number,
  ghCount: number,
  memoryBlock: string,
  lessonsBlock: string,
  activeProject?: { key: string; name: string } | null,
) {
  const parts = [getDinaSystemPrompt()];
  if (memoryBlock) {
    parts.push("", memoryBlock);
  }
  if (lessonsBlock) {
    parts.push("", lessonsBlock);
  }
  parts.push("", "SESSION RUNTIME:");
  const active = formatActiveProjectRuntime(activeProject);
  if (active) parts.push(active);
  parts.push(
    "ACTION RECEIPTS (critical): Never tell Derek you sent, moved, uploaded, deleted, created, marked, blocked, or otherwise completed an action unless a tool in THIS turn returned ok=true for that action. Intent, prior chat claims, and 'I was going to' are not proof. If ok=false or you did not call the tool, say it failed or was not done. Prefer quoting path/id/link from the tool payload.",
    "Chat attachments are local to Dina — they are NOT on OneDrive/Gmail until a write/upload tool succeeds with ok=true. Never say you 'moved' a chat file unless write_onedrive_file (or equivalent) succeeded and verified.",
    "NEVER INVENT (critical): Do not invent people, talks, quotes, emails, meetings, file contents, GitHub status, or action outcomes. For Derek’s mail/calendar/files/GitHub/Planner/SharePoint/memory/tasks/Church citations: call a live tool THIS turn and cite ONLY ok=true facts. If you lack evidence, say you do not know / cannot verify — never fill with plausible fiction.",
    "Church citation tools are enabled: search_church_site, fetch_church_url.",
    "Memory tools are enabled (search_memory, remember, correct_memory, approve_memory, archive_memory, merge_memories, list_memories).",
    "Memory is structured long-term knowledge — never treat the chat transcript as memory.",
    "Only remember durable facts per Memory Rules. Foundational memories may be pending_approval — ask Derek to approve, then call approve_memory.",
    "Correct existing memories by id instead of duplicating. Low-confidence memories must not silently drive important decisions.",
    "Do not rewrite or contradict the Dina Constitution via memory tools.",
    "Project task tools are enabled (list_project_tasks, add_project_task, complete_project_task, update_project_task).",
    "For per-project backlogs ('remaining tasks for Dina', 'mark 6 complete', 'add a Dina task'), ALWAYS use project task tools — never Memory commitments and never invent a list from chat history.",
    "Waiting On Engine tracks external waits (on Derek / others); ProjectTask is the live backlog of work items on a named project.",
    "Writing Assistant tool enabled: draft_in_dereks_voice. When Derek asks to write, draft, or reply, call draft_in_dereks_voice first (do not invent a long draft without the tool).",
    "draft_in_dereks_voice never sends. After Derek approves, use send_email or create_reply_draft.",
    "Star tools enabled: list_starred_messages, get_starred_message, unstar_message.",
    "When Derek asks for starred chats/messages/pins, call list_starred_messages then get_starred_message for full verbatim text.",
    "Morning Ritual tool enabled: generate_morning_brief. When anyone asks for morning brief / morning ritual, call it and pass userText. Never invent the section picker yourself — only show what the tool returns. If the tool returns a numbered list, every item must appear. After they pick, call the tool again with their reply. Morning Ritual is NOT the CoS Daily Briefing and does not include calendar.",
    "Team tools enabled: list_projects, create_project, archive_project, list_teammates, add_teammate_to_project, invite_teammate. New project → create_project (not Memory alone). New login → invite_teammate. Existing teammate / add to a project / no second invite → add_teammate_to_project. Do not invent an email address.",
  );
  parts.push(
    `Current datetime (${getDefaultTimeZone()}): ${denverNowLabel()}.`,
    "Treat that clock as authoritative for today/tomorrow.",
  );
  if (msConfigured && msCount) {
    parts.push(
      `${msCount} Microsoft Graph tools are enabled, including brief_inbox, get_email, get_emails, list_calendar_events, ensure_mail_folder, create_inbox_rule, and mark_matching_emails_read.`,
      "These are the WORK Outlook / Microsoft 365 account. Always label results as Work/Outlook.",
      "For requests to create folders or inbox rules, you MUST call those tools. Do not answer with manual Outlook instructions.",
      "For WORK email summaries/digests/triage, you MUST call brief_inbox (or get_emails). brief_inbox auto-marks marketing/spam read (autoCleared); summarize textBody for remaining emails[] and only briefly note what was cleared.",
      "For WORK calendar/schedule/agenda questions, you MUST call list_calendar_events and report every returned item with its when/timeZone fields.",
      "Trust live list_calendar_events JSON over earlier chat messages that claimed the calendar was empty or that a meeting was missing.",
      "Never say an event needs to be added manually when list_calendar_events already returned it.",
      "For Planner questions, call list_planner_plans then list_planner_tasks. Never claim Planner is unavailable.",
      "For SharePoint document folders, call list_sharepoint_folder. For SharePoint Lists (Network Info, contacts, etc.), call list_sharepoint_lists or get_sharepoint_list_items — never look for lists inside Dev Docs.",
      "Never claim SharePoint is unavailable.",
      'Never include a Links section, Outlook/OWA links, SendGrid/click-tracking URLs, or CTA buttons like "Save My Seat" / "Read More".',
    );
  }
  if (googleConfigured) {
    parts.push(
      `${googleCount} Google tools are enabled for the PERSONAL Gmail / Google Calendar account (gmail_brief_inbox, gmail_get_email, google_list_calendar_events, …).`,
      "Always label Google results as Personal/Gmail or Personal/Google Calendar. Never mix with Work/Outlook tools or results.",
      "For PERSONAL email digests, call gmail_brief_inbox (not brief_inbox).",
      "For PERSONAL calendar questions, call google_list_calendar_events (not list_calendar_events).",
      "When Derek does not specify which inbox/calendar, call list_mail_accounts first, then check both if needed.",
      "After gmail_brief_inbox, treat emails[].index as #1/#2/…. For 'block #N': block_attention_sender(target=emails[N-1].from.address) then gmail_mark_read(messageId=emails[N-1].id). For 'show #N': gmail_get_email with the FULL emails[N-1].id — never truncate ids.",
      "If a Gmail tool errors, report the tool error and retry with the exact id from the latest brief — do not claim the message is inaccessible without retrying.",
    );
  }
  if (msConfigured || googleConfigured) {
    parts.push(
      "Multi-account mail/calendar: Work = Microsoft 365 tools (unprefixed). Personal = gmail_* / google_* tools. Never assume one account. Name the account in every answer.",
      "Attention block tools (block_attention_sender / unblock / list) apply to both Work and Personal Attention scans when mail is configured.",
    );
  }
  if (msConfigured && !googleConfigured) {
    parts.push(
      "Personal Gmail/Google is NOT configured. Do not invent personal inbox results. If Derek asks about personal Gmail, say Google is not connected yet and only report Work/Outlook if you checked it.",
    );
  }
  if (!msConfigured && googleConfigured) {
    parts.push(
      "Work Microsoft 365 is NOT configured. Do not invent Outlook results. Only report Personal Google if you checked it.",
    );
  }
  if (ghCount) {
    parts.push(
      `${ghCount} GitHub tools are enabled across multiple accounts (list_github_accounts, list_github_repositories, list_github_projects, github_activity, which_github_account_owns_repo).`,
      "Always include the GitHub account id/label with repositories and events. Never assume one owner/org for all repos.",
      "For project context (what repos/products are), call list_github_projects.",
      "If one GitHub account fails, still report healthy accounts.",
    );
  }
  return parts.join("\n");
}

function withLastUserText(argsJson: string, lastUserText: string): string {
  if (!lastUserText) return argsJson || "{}";
  try {
    const args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
    if (!args.userText) args.userText = lastUserText;
    return JSON.stringify(args);
  } catch {
    return argsJson;
  }
}

async function executeTool(
  name: string,
  argsJson: string,
  lastUserText = "",
): Promise<string> {
  if (listMemoryToolNames().includes(name)) {
    return executeMemoryTool(name, argsJson);
  }
  if (listStarToolNames().includes(name)) {
    return executeStarTool(name, argsJson);
  }
  if (listMorningRitualToolNames().includes(name)) {
    return executeMorningRitualTool(name, withLastUserText(argsJson, lastUserText));
  }
  if (listChurchToolNames().includes(name)) {
    return executeChurchTool(name, argsJson);
  }
  if (listProjectTaskToolNames().includes(name)) {
    return executeProjectTaskTool(name, argsJson);
  }
  if (listWritingToolNames().includes(name)) {
    return executeWritingTool(name, argsJson);
  }
  if (listGitHubToolNames().includes(name)) {
    return executeGitHubTool(name, argsJson);
  }
  if (listMicrosoftToolNames().includes(name)) {
    return executeMicrosoftTool(name, argsJson);
  }
  if (listGoogleToolNames().includes(name)) {
    return executeGoogleTool(name, argsJson);
  }
  if (listTeamToolNames().includes(name)) {
    return executeTeamTool(name, argsJson);
  }
  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
}

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";

  async *streamChat(input: {
    messages: ProviderMessage[];
    signal?: AbortSignal;
    memoryBlock?: string;
    actor?: import("@/lib/ai/provider").ChatActor;
  }): AsyncIterable<StreamEvent> {
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      yield { type: "error", message: "OpenAI is not configured. Set OPENAI_API_KEY." };
      return;
    }

    if (isOpenAICreditsBlocked()) {
      yield { type: "error", message: openAICreditsUserMessage() };
      return;
    }

    const client = new OpenAI({ apiKey, timeout: 120_000 });
    const model = getOpenAIChatModel();
    const isMember = input.actor?.role === "member";
    const msTools = isMember ? [] : getMicrosoftToolDefinitions();
    const googleTools = isMember ? [] : getGoogleToolDefinitions();
    const ghTools = isMember ? [] : getGitHubToolDefinitions();
    const memoryTools = isMember
      ? getMemberMemoryToolDefinitions()
      : getMemoryToolDefinitions();
    const starTools = isMember ? [] : getStarToolDefinitions();
    const projectTaskTools = getProjectTaskToolDefinitions();
    const writingTools = isMember ? [] : getWritingToolDefinitions();
    const morningRitualTools = getMorningRitualToolDefinitions();
    const churchTools = isMember ? [] : getChurchToolDefinitions();
    const teamTools = isMember ? [] : getTeamToolDefinitions();
    const tools = [
      ...msTools,
      ...googleTools,
      ...ghTools,
      ...memoryTools,
      ...starTools,
      ...projectTaskTools,
      ...writingTools,
      ...morningRitualTools,
      ...churchTools,
      ...teamTools,
    ];
    const toolNames = new Set(tools.map((t) => t.name));
    const lessonsBlock = isMember
      ? ""
      : formatLessonsForPrompt(await listActiveLessons());
    const instructions = isMember
      ? [
          getMemberSystemPrompt({
            userName: input.actor?.name || "teammate",
            assistantName: input.actor?.assistantName || "Assistant",
            assistantPersona: input.actor?.assistantPersona || "",
            projectNames: input.actor?.projectNames || [],
            activeProject: input.actor?.activeProject,
          }),
          input.memoryBlock || "",
          "SESSION RUNTIME:",
          "ACTION RECEIPTS: never claim you added, completed, or updated a task unless a tool in THIS turn returned ok=true.",
          "Project task tools: list_project_tasks, add_project_task, complete_project_task, update_project_task.",
          "Memory tools (project-scoped only): search_memory, list_memories, remember, correct_memory.",
          "Morning Ritual tool enabled: generate_morning_brief. When they say Morning brief, call it and pass userText. Never invent the section picker — show the tool's numbered list verbatim. After they pick numbers, call it again with their reply.",
        ]
          .filter(Boolean)
          .join("\n")
      : buildInstructions(
          isMicrosoftConfigured(),
          isGoogleConfigured(),
          msTools.length,
          googleTools.length,
          ghTools.length,
          input.memoryBlock || "",
          lessonsBlock,
          input.actor?.activeProject,
        );
    logger.info("chat_model", { model });

    const turnRef: { current: StreamUsage } = {
      current: { ...emptyUsageTotals(), model },
    };
    attachChatTurnUsage(turnRef);

    try {
      let nextInput: OpenAI.Responses.ResponseInput = buildInput(input.messages);
      let previousResponseId: string | undefined;
      let finalText = "";
      let finalResponseId: string | undefined;
      const maxRounds = 8;
      const lastUserText = [...input.messages]
        .reverse()
        .find((m) => m.role === "user")
        ?.content || "";
      const forceCalendar = !isMember && isCalendarQuestion(lastUserText);
      const forceEmail =
        !isMember && isEmailQuestion(lastUserText) && !forceCalendar;
      const forceGitHub =
        Boolean(ghTools.length) && isGitHubQuestion(lastUserText);
      const forceOneDrive =
        Boolean(msTools.length) && isOneDriveQuestion(lastUserText);
      const forcePlanner =
        Boolean(msTools.length) && isPlannerQuestion(lastUserText);
      const forceSharePointList =
        Boolean(msTools.length) && isSharePointListQuestion(lastUserText);
      const forceSharePoint =
        Boolean(msTools.length) &&
        !forceSharePointList &&
        isSharePointQuestion(lastUserText);
      const forceWordDoc =
        Boolean(msTools.length) &&
        isWordDocumentRequest(lastUserText) &&
        !forceSharePointList;
      const maybeMorningReply =
        isMorningBriefRequest(lastUserText) ||
        looksLikeSectionSelection(lastUserText);
      const morningPref =
        maybeMorningReply && input.actor?.id
          ? await getMorningBriefPreference(input.actor.id)
          : null;
      const forceMorningBrief =
        toolNames.has("generate_morning_brief") &&
        (isMorningBriefRequest(lastUserText) ||
          (morningPref?.status === "pending" &&
            looksLikeSectionSelection(lastUserText)));
      const forceChurchCitation =
        !isMember &&
        !forceMorningBrief &&
        isChurchCitationQuestion(lastUserText);
      const forceEvidenceAsk = !isMember && requiresLiveEvidence(lastUserText);
      const requiredEvidenceDomains = evidenceDomainsForQuestion(lastUserText);
      let stallNudgeUsed = false;
      let citationNudgeCount = 0;
      let evidenceNudgeUsed = false;
      let churchCitationOkThisTurn = false;
      const satisfiedEvidenceDomains = new Set<EvidenceDomain>();
      const evidenceOkThisTurn = () =>
        allRequiredDomainsMet(
          satisfiedEvidenceDomains,
          requiredEvidenceDomains,
        );
      const citationNudgeUsed = () => citationNudgeCount > 0;

      for (let round = 0; round < maxRounds; round += 1) {
        if (input.signal?.aborted) break;

        yield {
          type: "status",
          status: round === 0 ? "thinking" : "working",
          detail:
            round === 0
              ? forceMorningBrief
                ? isMorningBriefSetupRequest(lastUserText) ||
                  morningPref?.status === "pending"
                  ? "Setting up morning brief…"
                  : "Preparing morning brief…"
                : forceChurchCitation
                  ? "Verifying Church sources…"
                  : forceEmail
                    ? "Checking email…"
                    : forceCalendar
                      ? "Checking calendar…"
                      : forceWordDoc
                        ? "Preparing Word document…"
                        : "On it…"
              : "Working…",
        };

        const pickMissingDomainTool = (): string | null => {
          const missing = requiredEvidenceDomains.filter(
            (d) => !satisfiedEvidenceDomains.has(d),
          );
          for (const domain of missing) {
            if (domain === "church" && toolNames.has("search_church_site")) {
              return "search_church_site";
            }
            if (domain === "mail") {
              if (toolNames.has("brief_inbox")) return "brief_inbox";
              if (toolNames.has("gmail_brief_inbox")) return "gmail_brief_inbox";
            }
            if (domain === "calendar") {
              if (toolNames.has("list_calendar_events")) {
                return "list_calendar_events";
              }
              if (toolNames.has("google_list_calendar_events")) {
                return "google_list_calendar_events";
              }
            }
            if (domain === "github" && toolNames.has("github_activity")) {
              return "github_activity";
            }
            if (
              domain === "onedrive" &&
              toolNames.has("list_onedrive_children")
            ) {
              return "list_onedrive_children";
            }
            if (domain === "planner" && toolNames.has("list_planner_plans")) {
              return "list_planner_plans";
            }
            if (domain === "sharepoint") {
              if (toolNames.has("get_sharepoint_list_items") && forceSharePointList) {
                return "get_sharepoint_list_items";
              }
              if (toolNames.has("list_sharepoint_folder")) {
                return "list_sharepoint_folder";
              }
            }
            if (
              domain === "morning" &&
              toolNames.has("generate_morning_brief")
            ) {
              return "generate_morning_brief";
            }
          }
          return null;
        };

        const forcedToolName = (() => {
          if (forceMorningBrief && round === 0) return "generate_morning_brief";
          if (
            (forceChurchCitation || citationNudgeUsed()) &&
            !churchCitationOkThisTurn &&
            (round === 0 || citationNudgeUsed())
          ) {
            return "search_church_site";
          }
          if (forceCalendar && round === 0) {
            if (toolNames.has("list_calendar_events")) {
              return "list_calendar_events";
            }
            if (toolNames.has("google_list_calendar_events")) {
              return "google_list_calendar_events";
            }
          }
          if (forceEmail && round === 0) {
            if (toolNames.has("brief_inbox")) return "brief_inbox";
            if (toolNames.has("gmail_brief_inbox")) return "gmail_brief_inbox";
          }
          if (forceGitHub && round === 0 && toolNames.has("github_activity")) {
            return "github_activity";
          }
          if (
            forceOneDrive &&
            round === 0 &&
            toolNames.has("list_onedrive_children")
          ) {
            return "list_onedrive_children";
          }
          if (forcePlanner && round === 0) return "list_planner_plans";
          if (forceSharePointList && round === 0) {
            return "get_sharepoint_list_items";
          }
          if (forceSharePoint && round === 0) return "list_sharepoint_folder";
          if (forceWordDoc && stallNudgeUsed) return "create_word_document";
          if (
            (evidenceNudgeUsed || (forceEvidenceAsk && round === 0)) &&
            !evidenceOkThisTurn()
          ) {
            return pickMissingDomainTool();
          }
          return null;
        })();

        // Word/doc asks must use tools (memory + create_word_document), not filler chat.
        // Evidence asks must call live tools before inventing Derek's world.
        const requireAnyTool =
          stallNudgeUsed ||
          citationNudgeUsed() ||
          evidenceNudgeUsed ||
          (forceWordDoc && round === 0 && !forcedToolName) ||
          (forceChurchCitation && round === 0 && !forcedToolName) ||
          (forceEvidenceAsk && round === 0 && !forcedToolName) ||
          (citationNudgeUsed() && !churchCitationOkThisTurn);

        const toolChoice =
          !tools.length
            ? undefined
            : forcedToolName
              ? {
                  type: "function" as const,
                  name: forcedToolName,
                }
              : requireAnyTool
                ? ("required" as const)
                : ("auto" as const);

        const stream = await client.responses.create(
          {
            model,
            instructions,
            input: nextInput,
            previous_response_id: previousResponseId,
            tools: tools.length ? tools : undefined,
            tool_choice: toolChoice,
            stream: true,
          },
          { signal: input.signal },
        );

        let responseId: string | undefined;
        let text = "";
        let completed: OpenAI.Responses.Response | undefined;
        const streamedCalls = new Map<string, FunctionCallItem>();

        for await (const event of stream) {
          if (input.signal?.aborted) break;

          if (event.type === "response.created") {
            responseId = event.response.id;
          }

          if (event.type === "response.output_item.done") {
            const item = event.item;
            if (item.type === "function_call") {
              streamedCalls.set(item.call_id, {
                type: "function_call",
                call_id: item.call_id,
                name: item.name,
                arguments: item.arguments,
              });
            }
          }

          if (event.type === "response.output_text.delta") {
            // Buffer until we know this round is final (no tool calls).
            text += event.delta;
          }

          if (event.type === "response.completed") {
            completed = event.response;
            responseId = event.response.id;
            if (!text && event.response.output_text) {
              text = event.response.output_text;
            }
          }

          if (event.type === "error") {
            yield {
              type: "error",
              message: event.message || "OpenAI returned an error.",
            };
            return;
          }
        }

        if (!completed) {
          if (text) {
            yield { type: "delta", text };
            yield {
              type: "done",
              responseId,
              text,
              usage:
                turnRef.current.calls > 0 ? turnRef.current : undefined,
            };
            return;
          }
          yield { type: "error", message: "OpenAI response ended unexpectedly." };
          return;
        }

        const fromCompleted = collectFunctionCalls(completed.output || []);
        const functionCalls =
          fromCompleted.length > 0 ? fromCompleted : Array.from(streamedCalls.values());
        finalResponseId = completed.id;
        recordOpenAIUsage({
          feature: "chat",
          model: completed.model || model,
          response: completed,
          meta: {
            round,
            tools: functionCalls.map((c) => c.name),
            forceEvidenceAsk,
            forceMorningBrief,
            forceChurchCitation,
          },
        });

        if (!functionCalls.length) {
          finalText = text || completed.output_text || "";
          // Model said “please hold…” / “I’ll prepare…” without calling tools — nudge and continue.
          if (
            !stallNudgeUsed &&
            tools.length &&
            round < maxRounds - 1 &&
            looksLikeStallingFiller(finalText)
          ) {
            stallNudgeUsed = true;
            logger.info("stall_filler_nudge", {
              preview: finalText.slice(0, 160),
            });
            yield {
              type: "status",
              status: "working",
              detail: forceWordDoc
                ? "Still working — writing the document…"
                : "Still working — calling tools…",
            };
            previousResponseId = completed.id;
            nextInput = [
              {
                role: "user",
                content:
                  "Stop saying please hold / one moment. You ended the turn without calling tools. Call the required tools NOW and finish the work in this turn. If Derek asked for a Word document, call create_word_document with the FULL content (from memory/chat) and conflictBehavior=replace. Do not reply with filler.",
              },
            ];
            continue;
          }
          // Cited Church talks/people without a successful church tool this turn — refuse fabrication.
          if (
            citationNudgeCount < 2 &&
            tools.length &&
            round < maxRounds - 1 &&
            !churchCitationOkThisTurn &&
            !looksLikeHonestUncertainty(finalText) &&
            looksLikeUnverifiedChurchCitation(finalText)
          ) {
            citationNudgeCount += 1;
            logger.info("church_citation_nudge", {
              forceChurchCitation,
              attempt: citationNudgeCount,
              preview: finalText.slice(0, 160),
            });
            yield {
              type: "status",
              status: "working",
              detail: "Verifying Church sources…",
            };
            previousResponseId = completed.id;
            nextInput = [
              {
                role: "user",
                content:
                  "STOP. You cited Church talks/speakers/people/quotes without a successful search_church_site or fetch_church_url (ok=true) in this turn. Call search_church_site NOW. Cite ONLY verified results with URLs. If verification fails, say you cannot verify it — do NOT invent talks, people, or thematic stand-ins for a lesson.",
              },
            ];
            continue;
          }
          // Asserted live-world facts without any evidence tool ok=true this turn.
          if (
            !evidenceNudgeUsed &&
            tools.length &&
            round < maxRounds - 1 &&
            !evidenceOkThisTurn() &&
            !looksLikeHonestUncertainty(finalText) &&
            (forceEvidenceAsk || looksLikeUnverifiedLiveClaim(finalText))
          ) {
            evidenceNudgeUsed = true;
            logger.info("evidence_nudge", {
              forceEvidenceAsk,
              preview: finalText.slice(0, 160),
            });
            yield {
              type: "status",
              status: "working",
              detail: "Checking live sources…",
            };
            previousResponseId = completed.id;
            nextInput = [
              {
                role: "user",
                content:
                  "STOP. You stated facts about Derek’s mail/calendar/files/GitHub/systems (or were asked for them) without a successful evidence tool (ok=true) in this turn. Call the appropriate live tool NOW and answer ONLY from the tool payload. If the tool fails or returns nothing, say you cannot verify it — do NOT invent plausible details.",
              },
            ];
            continue;
          }
          if (finalText) yield { type: "delta", text: finalText };
          break;
        }

        const toolOutputs: OpenAI.Responses.ResponseInputItem[] = [];
        let morningDirectMarkdown: string | null = null;
        for (const call of functionCalls) {
          yield {
            type: "status",
            status: "tool",
            detail: friendlyToolStatus(call.name),
          };
          logger.info("tool_call", { tool: call.name });
          let output = await executeTool(
            call.name,
            call.arguments || "{}",
            lastUserText,
          );
          if (call.name === "list_calendar_events") {
            try {
              const parsed = JSON.parse(output) as {
                ok?: boolean;
                data?: { count?: number; items?: unknown[] };
                instruction?: string;
              };
              if (parsed.ok && (parsed.data?.count ?? 0) > 0) {
                output = JSON.stringify({
                  ...parsed,
                  instruction:
                    "AUTHORITATIVE LIVE CALENDAR DATA. Report every item to Derek with subject + when. Do not claim the calendar is empty. Do not offer to add events that are already listed.",
                });
              }
            } catch {
              // keep raw output
            }
          }
          output = annotateToolOutput(call.name, output);
          output = annotateCitationToolOutput(call.name, output);
          if (call.name === "generate_morning_brief") {
            morningDirectMarkdown =
              extractMorningBriefPresentMarkdown(output) || morningDirectMarkdown;
          }
          if (
            isChurchCitationTool(call.name) &&
            churchToolSucceeded(output)
          ) {
            churchCitationOkThisTurn = true;
            satisfiedEvidenceDomains.add("church");
          }
          if (evidenceToolSucceeded(output)) {
            const domains =
              requiredEvidenceDomains.length > 0
                ? requiredEvidenceDomains
                : ([
                    "mail",
                    "calendar",
                    "github",
                    "onedrive",
                    "planner",
                    "sharepoint",
                    "church",
                    "morning",
                  ] as EvidenceDomain[]);
            for (const domain of domainsSatisfiedByTool(call.name, domains)) {
              satisfiedEvidenceDomains.add(domain);
            }
          }
          toolOutputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output,
          });
        }

        if (
          morningDirectMarkdown &&
          functionCalls.every((call) => call.name === "generate_morning_brief")
        ) {
          finalText = morningDirectMarkdown;
          yield { type: "delta", text: morningDirectMarkdown };
          break;
        }

        previousResponseId = completed.id;
        nextInput = toolOutputs;
      }

      yield {
        type: "done",
        responseId: finalResponseId,
        text: finalText,
        usage: turnRef.current.calls > 0 ? turnRef.current : undefined,
      };
    } catch (error) {
      logger.error("openai_stream_failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      if (isOpenAICreditsError(error)) {
        markOpenAICreditsExhausted();
        yield { type: "error", message: openAICreditsUserMessage() };
        return;
      }
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Request was cancelled."
          : "Dina could not reach OpenAI right now. Please try again.";
      yield { type: "error", message };
    } finally {
      detachChatTurnUsage(turnRef);
    }
  }
}
