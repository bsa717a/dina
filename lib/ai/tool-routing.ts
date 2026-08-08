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
    brief_inbox: "Reading inbox…",
    list_calendar_events: "Checking calendar…",
  };
  return map[toolName] || `Running ${toolName}…`;
}
