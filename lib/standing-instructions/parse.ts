export type StandingInstructionRequest =
  | { kind: "help" }
  | { kind: "list" }
  | { kind: "set"; title: string; content: string }
  | { kind: "archive"; title: string };

const LIST =
  /^(show|list|what are|what(?:'s| is)|which are)\s+(?:my\s+)?standing\s+(?:instructions?|rules?)\b/i;

const LIST_FOLLOW =
  /^what standing (?:instructions?|rules?) do you (?:follow|have|use)\b/i;

const LIST_BARE = /^(standing (?:instructions?|rules?))$/i;

const SET =
  /^(?:standing (?:instruction|rule)|make this(?: a)? standing (?:instruction|rule)|make this stick|put this in standing (?:instructions?|rules?)|from now on|always do this|never do this)\s*[:—-]\s*(.+)$/i;

const SET_BARE = /^(?:standing (?:instruction|rule))\s+(.+)$/i;

const ARCHIVE =
  /^(?:forget|archive|drop|stop following|remove)\s+(?:standing (?:instruction|rule)\s*[:—-]?\s*)(.+)$/i;

const HELP =
  /^(?:how (?:can|do) I (?:get you to |make you )?remember(?: this)?|how (?:can|do) I make this stick|how (?:do|can)(?: I)?(?: use| add| set| create)? standing instructions?(?: work)?|how do I (?:add|set|create|use) (?:a )?standing (?:instruction|rule))\s*[.?!]?\s*$/i;

function titleFromRule(rule: string): string {
  const trimmed = rule.trim().replace(/\s+/g, " ").replace(/[.]+$/, "");
  const clipped =
    trimmed.length <= 72 ? trimmed : `${trimmed.slice(0, 69).trimEnd()}…`;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

/** Owner chat phrases that persist without the model. */
export function parseStandingInstructionRequest(
  text: string,
): StandingInstructionRequest | null {
  const t = text.trim();
  if (!t) return null;
  if (/\band\b/i.test(t) && !SET.test(t) && !SET_BARE.test(t) && !ARCHIVE.test(t)) {
    return null;
  }
  if (HELP.test(t)) {
    return { kind: "help" };
  }
  if (LIST.test(t) || LIST_FOLLOW.test(t) || LIST_BARE.test(t)) {
    return { kind: "list" };
  }
  const archive = t.match(ARCHIVE);
  if (archive?.[1]) {
    return { kind: "archive", title: archive[1].trim().replace(/[.]+$/, "") };
  }
  const set = t.match(SET) || t.match(SET_BARE);
  if (set?.[1]) {
    const content = set[1].trim();
    if (!content) return null;
    return { kind: "set", title: titleFromRule(content), content };
  }
  return null;
}

export function isStandingInstructionListRequest(text: string): boolean {
  return parseStandingInstructionRequest(text)?.kind === "list";
}
