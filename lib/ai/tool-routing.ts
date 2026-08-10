/** Detects filler “I’ll do it in a moment” replies that end the turn without tools. */
export function looksLikeStallingFiller(content: string) {
  const text = content.trim();
  if (!text) return false;
  return (
    /\b(please hold|hold on|one moment|just a (sec|second|moment)|give me a (sec|second|moment)|hang tight|bear with me)\b/i.test(
      text,
    ) ||
    /\b(i will|i'll|let me)\b.{0,40}\b(prepare|assemble|create|update|build|write|generate|put together)\b.{0,60}\b(document|docx|word|file|lesson)\b/i.test(
      text,
    ) ||
    /\b(prepare|assembling|working on)\b.{0,40}\b(complete document|full (content|document)|word document)\b/i.test(
      text,
    )
  );
}

export function isCalendarQuestion(text: string) {
  return /\b(calendar|schedule|agenda|what'?s on|what is on|meetings?\b.*\b(today|tomorrow)|am i free)\b/i.test(
    text,
  );
}

export function isEmailQuestion(text: string) {
  return (
    /\b(inbox|unread|emails?|e-mails?|gmail|outlook)\b/i.test(text) ||
    /\b(brief|check|triage|digest)\b[\s\S]{0,40}\b(mail|inbox)\b/i.test(text) ||
    /\b(mail|inbox)\b[\s\S]{0,40}\b(brief|check|triage|digest|today)\b/i.test(
      text,
    )
  );
}

export function isGitHubQuestion(text: string) {
  return /\b(github|pull requests?|\bPRs?\b|workflow|actions|repos?(itory|itories)?|commits?)\b/i.test(
    text,
  );
}

export function isOneDriveQuestion(text: string) {
  return /\b(onedrive|one drive|my files)\b/i.test(text);
}

/** Any ask that must be answered from live tools, not model invention. */
export function requiresLiveEvidence(text: string) {
  // Word/doc creation is gated by forceWordDoc + action receipts separately.
  return (
    isCalendarQuestion(text) ||
    isEmailQuestion(text) ||
    isGitHubQuestion(text) ||
    isOneDriveQuestion(text) ||
    isPlannerQuestion(text) ||
    isSharePointQuestion(text) ||
    isSharePointListQuestion(text) ||
    isChurchCitationQuestion(text) ||
    isMorningBriefRequest(text)
  );
}

export function isPlannerQuestion(text: string) {
  return /\bplanner\b|\bplan board\b|\bbuckets?\b.*\btasks?\b|\btasks?\b.*\bplanner\b/i.test(
    text,
  );
}

export function isSharePointQuestion(text: string) {
  return /\bshare\s*point\b|\bsharepoint\b|\b4sl tech projects\b|\bdev docs\b/i.test(
    text,
  );
}

/** Only explicit SharePoint Lists — never generic “list” / remembered lists. */
export function isSharePointListQuestion(text: string) {
  return (
    /\bshare\s*point\s+list\b/i.test(text) ||
    /\bsharepoint\s+list\b/i.test(text) ||
    /\bnetwork info\b/i.test(text) ||
    /\b4sl contacts\b/i.test(text)
  );
}

export function isWordDocumentRequest(text: string) {
  return (
    /\b(word\s+doc(ument)?s?|\.docx|docx)\b/i.test(text) ||
    /\b(create|update|rebuild|write|put|save)\b[\s\S]{0,80}\b(word\s+doc|document)\b/i.test(
      text,
    ) ||
    /\b(document)\b[\s\S]{0,40}\b(onedrive|word)\b/i.test(text)
  );
}

/** On-demand Morning Ritual (CFM + BoM + markets) — not the CoS Daily Briefing. */
export function isMorningBriefRequest(text: string) {
  return (
    /\bmorning\s+brief\b/i.test(text) ||
    /\bmorning\s+ritual\b/i.test(text) ||
    /\bgenerate\s+(my\s+)?morning\s+brief\b/i.test(text)
  );
}

/**
 * Lesson / talk / Church citation asks that must use search_church_site
 * (or fetch_church_url) before naming talks, speakers, or people.
 */
export function isChurchCitationQuestion(text: string) {
  if (isMorningBriefRequest(text)) return false;
  // Colloquial “talk about my calendar/inbox” is not a Church citation ask.
  if (
    isCalendarQuestion(text) ||
    isEmailQuestion(text) ||
    isGitHubQuestion(text) ||
    isOneDriveQuestion(text) ||
    isPlannerQuestion(text) ||
    isSharePointQuestion(text)
  ) {
    return false;
  }
  return (
    /\bgeneral\s+conference\b/i.test(text) ||
    /\b(come[, ]?\s*follow\s*me|cfm)\b/i.test(text) ||
    /\bchurchofjesuschrist\.org\b/i.test(text) ||
    /\b(find|get|give|suggest|recommend|need|want|look\s*up|search\s*for|pull)\b[\s\S]{0,80}\b(talk|talks|quote|quotes|address)\b/i.test(
      text,
    ) ||
    /\b(conference\s+)?(talk|talks|quote|quotes)\b[\s\S]{0,60}\b(about|on|for|by|from)\b/i.test(
      text,
    ) ||
    /\b(elder|sister|president)\s+[A-Z][a-z]+/i.test(text) ||
    /\b(nelson|oaks|holland|uchtdorf|bednar|eyring|christofferson)\b/i.test(
      text,
    ) ||
    /\b(for\s+the\s+lesson|lesson\s+resource|temple\s+lesson|eq\s+lesson|elders?\s+quorum\s+lesson)\b/i.test(
      text,
    )
  );
}

/** Final reply that looks like it cited Church material (for refuse-if-unverified nudge). */
export function looksLikeUnverifiedChurchCitation(content: string) {
  const text = content.trim();
  if (!text) return false;
  return (
    /\bgeneral\s+conference\b/i.test(text) ||
    /\b(elder|sister|president)\s+[A-ZÀ-ÖØ-öø-ÿ][\w'’-]+/i.test(text) ||
    /\btalk\s+(titled|called|named)\b/i.test(text) ||
    /\b(in|from)\s+(his|her|their)\s+\d{4}\b/i.test(text) ||
    /\bchurchofjesuschrist\.org\/study\/general-conference\b/i.test(text) ||
    /\b(quoted|quoting)\b[\s\S]{0,40}\b(elder|sister|president|nelson|oaks)\b/i.test(
      text,
    )
  );
}

export function friendlyToolStatus(toolName: string) {
  const map: Record<string, string> = {
    create_word_document: "Writing Word document…",
    create_excel_workbook: "Creating Excel workbook…",
    create_powerpoint_presentation: "Creating PowerPoint…",
    read_word_document: "Reading Word document…",
    search_memory: "Searching memory…",
    remember: "Saving to memory…",
    list_memories: "Loading memories…",
    list_starred_messages: "Loading starred messages…",
    get_starred_message: "Opening starred message…",
    unstar_message: "Removing star…",
    get_sharepoint_list_items: "Reading SharePoint list…",
    list_sharepoint_lists: "Listing SharePoint lists…",
    list_onedrive_children: "Browsing OneDrive…",
    write_onedrive_file: "Writing OneDrive file…",
    create_sharepoint_note: "Creating SharePoint note…",
    brief_inbox: "Reading work inbox…",
    gmail_brief_inbox: "Reading personal Gmail…",
    list_calendar_events: "Checking work calendar…",
    google_list_calendar_events: "Checking personal calendar…",
    list_mail_accounts: "Listing mail accounts…",
    block_attention_sender: "Blocking Attention sender…",
    list_attention_blocks: "Listing Attention blocks…",
    generate_morning_brief: "Preparing morning brief…",
    search_church_site: "Verifying on ChurchofJesusChrist.org…",
    fetch_church_url: "Reading Church page…",
  };
  return map[toolName] || `Running ${toolName}…`;
}
