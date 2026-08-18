export const MORNING_BRIEF_SECTION_IDS = [
  "book_of_mormon",
  "come_follow_me",
  "market_brief",
  "market_intelligence",
  "stock_movers",
  "trader_edge",
  "top_stories",
  "st_george_news",
  "todays_win",
  "journal_prompt",
] as const;

export type MorningBriefSectionId = (typeof MORNING_BRIEF_SECTION_IDS)[number];

export type MorningBriefSection = {
  id: MorningBriefSectionId;
  number: number;
  title: string;
  summary: string;
};

export const MORNING_BRIEF_SECTIONS: MorningBriefSection[] = [
  {
    id: "book_of_mormon",
    number: 1,
    title: "Book of Mormon",
    summary: "Today's reading and a Read link",
  },
  {
    id: "come_follow_me",
    number: 2,
    title: "Come, Follow Me — Deep Study",
    summary: "Passage, insight, application, and a reflective question",
  },
  {
    id: "market_brief",
    number: 3,
    title: "Market brief",
    summary: "Short overnight / premarket tape",
  },
  {
    id: "market_intelligence",
    number: 4,
    title: "Business / Market Intelligence",
    summary: "A few intelligence bullets",
  },
  {
    id: "stock_movers",
    number: 5,
    title: "Big Stock Movers",
    summary: "Notable movers as reported",
  },
  {
    id: "trader_edge",
    number: 6,
    title: "Two Minute Trader Edge",
    summary: "A short trading note (not financial advice)",
  },
  {
    id: "top_stories",
    number: 7,
    title: "Top stories (last 12 hours)",
    summary: "Five clickable news stories",
  },
  {
    id: "st_george_news",
    number: 8,
    title: "St. George local news",
    summary: "One local story from the last 12 hours",
  },
  {
    id: "todays_win",
    number: 9,
    title: "Today's Win",
    summary: "One meaningful outcome for the day",
  },
  {
    id: "journal_prompt",
    number: 10,
    title: "Journal Prompt",
    summary: "One prompt to write from",
  },
];

export const DEFAULT_OWNER_SECTIONS: MorningBriefSectionId[] = [
  ...MORNING_BRIEF_SECTION_IDS,
];

const SECTION_BY_ID = new Map(
  MORNING_BRIEF_SECTIONS.map((section) => [section.id, section]),
);

export function isMorningBriefSectionId(
  value: string,
): value is MorningBriefSectionId {
  return SECTION_BY_ID.has(value as MorningBriefSectionId);
}

export function normalizeSectionIds(
  values: readonly string[],
): MorningBriefSectionId[] {
  const seen = new Set<MorningBriefSectionId>();
  for (const value of values) {
    if (isMorningBriefSectionId(value)) seen.add(value);
  }
  return MORNING_BRIEF_SECTION_IDS.filter((id) => seen.has(id));
}

export function sectionTitles(ids: readonly MorningBriefSectionId[]): string[] {
  return ids.map((id) => SECTION_BY_ID.get(id)?.title || id);
}

const TITLE_ALIASES: Array<{ id: MorningBriefSectionId; pattern: RegExp }> = [
  { id: "book_of_mormon", pattern: /\b(book of mormon|bom|b\.?o\.?m\.?)\b/i },
  {
    id: "come_follow_me",
    pattern: /\b(come[, ]?\s*follow\s*me|cfm|deep study)\b/i,
  },
  { id: "market_brief", pattern: /\bmarket brief\b/i },
  {
    id: "market_intelligence",
    pattern: /\b(business|market intelligence|intelligence)\b/i,
  },
  { id: "stock_movers", pattern: /\b(stock movers?|movers?)\b/i },
  { id: "trader_edge", pattern: /\b(trader edge|two minute)\b/i },
  { id: "top_stories", pattern: /\b(top stories|news|headlines)\b/i },
  { id: "st_george_news", pattern: /\b(st\.?\s*george|local news)\b/i },
  { id: "todays_win", pattern: /\btoday'?s win\b/i },
  { id: "journal_prompt", pattern: /\bjournal\b/i },
];

export function looksLikeSectionSelection(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    /^(all|none|cancel|never mind|keep( it| these| my (brief|sections))?|same)$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/^\d{1,2}([,\s]+(?:and\s+)?\d{1,2})+$/.test(trimmed)) return true;
  if (/^\d{1,2}\s*[-–—]\s*\d{1,2}$/.test(trimmed)) return true;
  if (/^[\d,\s]+$/.test(trimmed) && /\d/.test(trimmed)) return true;
  const named = TITLE_ALIASES.filter((alias) => alias.pattern.test(trimmed));
  if (!named.length || trimmed.length >= 240) return false;
  const leftover = named
    .reduce((text, alias) => text.replace(alias.pattern, " "), trimmed)
    .replace(/\b(and|or|the|my|a|please|also|plus|then)\b/gi, " ")
    .replace(/[,&]/g, " ")
    .trim();
  return leftover.length === 0;
}

export function parseSectionSelection(
  text: string,
):
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "ids"; ids: MorningBriefSectionId[] }
  | { kind: "unparsed" } {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "unparsed" };
  if (/^all\b/i.test(trimmed)) return { kind: "all" };
  if (/^none\b/i.test(trimmed)) return { kind: "none" };
  if (/^(cancel|never mind|keep( it| these| my (brief|sections))?|same)\b/i.test(trimmed)) {
    return { kind: "cancel" };
  }

  const ids = new Set<MorningBriefSectionId>();

  const range = trimmed.match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (const section of MORNING_BRIEF_SECTIONS) {
      if (section.number >= lo && section.number <= hi) ids.add(section.id);
    }
  } else {
    for (const match of trimmed.matchAll(/\b(\d{1,2})\b/g)) {
      const number = Number(match[1]);
      const section = MORNING_BRIEF_SECTIONS.find((item) => item.number === number);
      if (section) ids.add(section.id);
    }
  }

  for (const alias of TITLE_ALIASES) {
    if (alias.pattern.test(trimmed)) ids.add(alias.id);
  }

  if (!ids.size) return { kind: "unparsed" };
  return { kind: "ids", ids: normalizeSectionIds([...ids]) };
}

export function formatSetupMarkdown(input?: {
  selected?: readonly MorningBriefSectionId[];
  userName?: string;
}): string {
  const selected = new Set(input?.selected || []);
  const greeting = input?.userName ? `${input.userName}, pick` : "Pick";
  const lines = [
    "# Morning brief setup",
    "",
    `${greeting} the sections you want in your morning brief. Reply with the numbers (for example: \`1, 2, 7, 9\`) or \`all\`.`,
    "",
    "You can change this later by saying **Morning brief setup**.",
    "",
  ];
  for (const section of MORNING_BRIEF_SECTIONS) {
    const mark = selected.has(section.id) ? " ✓" : "";
    lines.push(
      `${section.number}. **${section.title}**${mark} — ${section.summary}`,
    );
  }
  if (selected.size) {
    lines.push(
      "",
      `Currently selected: ${sectionTitles([...selected]).join(", ")}`,
    );
  }
  return lines.join("\n");
}

export function formatSavedSetupMarkdown(
  ids: readonly MorningBriefSectionId[],
): string {
  if (!ids.length) {
    return "No sections saved. Say **Morning brief** to pick from the list.";
  }
  return [
    "Saved. Your morning brief will include:",
    "",
    ...ids.map((id, index) => `${index + 1}. ${SECTION_BY_ID.get(id)?.title || id}`),
    "",
    "Say **Morning brief** anytime. Say **Morning brief setup** to change this.",
  ].join("\n");
}

export function hasSection(
  ids: readonly MorningBriefSectionId[],
  id: MorningBriefSectionId,
): boolean {
  return ids.includes(id);
}

export function wantsMarketResearch(
  ids: readonly MorningBriefSectionId[],
): boolean {
  return (
    hasSection(ids, "market_brief") ||
    hasSection(ids, "market_intelligence") ||
    hasSection(ids, "stock_movers") ||
    hasSection(ids, "trader_edge")
  );
}

export function wantsNewsResearch(
  ids: readonly MorningBriefSectionId[],
): boolean {
  return hasSection(ids, "top_stories") || hasSection(ids, "st_george_news");
}
