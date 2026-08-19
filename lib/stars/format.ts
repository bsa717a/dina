import { STAR_SOFT_CAP, type StarredMessageRecord } from "@/lib/stars/store";

function roleLabel(role: string) {
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  return role;
}

function whenLabel(at: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

/** Compact live starred list for SESSION RUNTIME. Recite from this; no list/get tools needed. */
export function formatStarredMessagesRuntime(
  items: StarredMessageRecord[],
): string {
  const lines = [
    `Starred messages (live this turn — already loaded, ${items.length} of ${STAR_SOFT_CAP}, newest first):`,
  ];
  if (!items.length) {
    lines.push("- (none starred)");
    lines.push(
      "If asked for starred messages, say there are none. Do not invent pins from chat history.",
    );
    return lines.join("\n");
  }
  for (const [index, item] of items.entries()) {
    lines.push(
      `${index + 1}. [${roleLabel(item.role)}] id=${item.id} starred ${whenLabel(item.starredAt)}`,
    );
    lines.push(item.content.trim() || "(empty)");
    lines.push("---");
  }
  lines.push(
    "Recite this block when asked for starred chats/messages/pins. Do not call list_starred_messages or get_starred_message just to read it. Use unstar_message to remove a star. When exporting to Word or Memory, paste the FULL content from this block — do not summarize.",
  );
  return lines.join("\n");
}

/** User-facing starred list. No model involved. */
export function formatStarredMessagesMessage(
  items: StarredMessageRecord[],
): string {
  if (!items.length) {
    return `No starred messages (${STAR_SOFT_CAP} slots). Star a reply with ★ to keep it close.`;
  }
  const lines = [`Starred messages (${items.length} of ${STAR_SOFT_CAP}):`, ""];
  for (const [index, item] of items.entries()) {
    lines.push(
      `${index + 1}. ${roleLabel(item.role)} · ${whenLabel(item.starredAt)}`,
    );
    lines.push(item.content.trim() || "(empty)");
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Leftover cheap starred-list chat. Keep the current user turn. */
export function isStarredListChatContent(role: string, content: string): boolean {
  const text = content.trim();
  if (role === "user") return isStarredListRequest(text);
  if (role === "assistant") {
    return /^(Starred messages \(|No starred messages )/i.test(text);
  }
  return false;
}

/** Show/list starred messages only — not export, summarize, or fetch-by-id. */
export function isStarredListRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\band\b/i.test(t)) return false;
  if (
    /\b(word|docx|\.doc|remember|email|draft|onedrive|sharepoint|put|paste|into|summarize|rewrite|send)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  if (!/\b(starred|stars|star|pins?|pinned)\b/i.test(t)) return false;
  return (
    /\b(show|list|what|which|see|pull up|open)\b/i.test(t) ||
    /^(get )?starred( messages| chats| pins)?$/i.test(t) ||
    /^(my (stars|pins)|pins)$/i.test(t)
  );
}
