import { describe, expect, it } from "vitest";
import {
  friendlyToolStatus,
  isMorningBriefRequest,
} from "@/lib/ai/tool-routing";
import {
  buildMarketSearchQueries,
  rankMarketUrl,
} from "@/lib/morning-ritual/markets";
import { htmlToText, isChurchUrl } from "@/lib/morning-ritual/fetch";
import {
  generateMorningBriefMarkdown,
  stripValidationGateSection,
} from "@/lib/morning-ritual/compose";
import { extractMorningBriefPresentMarkdown } from "@/lib/morning-ritual/tools";
import { needsMorningBriefSetup } from "@/lib/morning-ritual/preferences";
import { formatTodaysWinContext } from "@/lib/morning-ritual/win-context";
import {
  formatSetupMarkdown,
  looksLikeSectionSelection,
  parseSectionSelection,
} from "@/lib/morning-ritual/sections";
import {
  buildNewsSearchQueries,
  formatNewsSection,
  parseNewsArticlesJson,
  rankNewsUrl,
  selectNewsArticles,
  upsertTopStoriesSection,
} from "@/lib/morning-ritual/news";
import {
  buildHeuristicWeekPlan,
  enforceUniqueMedia,
  isDurableWeekPlan,
  sanitizeMediaItem,
} from "@/lib/morning-ritual/week-plan";
import type { CfmLesson, WeekPlan } from "@/lib/morning-ritual/types";

describe("morning ritual routing and helpers", () => {
  it("does not expand an explicit empty section list to the full brief", async () => {
    const result = await generateMorningBriefMarkdown({ sections: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No morning brief sections selected/);
  });

  it("does not treat pending setup as blocking when sections are already saved", () => {
    expect(
      needsMorningBriefSetup(
        { role: "member" },
        {
          userId: "u1",
          sections: ["top_stories", "todays_win"],
          status: "pending",
          pendingReason: "setup",
        },
      ),
    ).toBe(false);
    expect(
      needsMorningBriefSetup(
        { role: "member" },
        {
          userId: "u1",
          sections: [],
          status: "pending",
          pendingReason: "generate",
        },
      ),
    ).toBe(true);
  });

  it("extracts morning brief markdown for direct presentation", () => {
    const list = formatSetupMarkdown();
    expect(
      extractMorningBriefPresentMarkdown(
        JSON.stringify({ ok: true, data: { mode: "setup", markdown: list } }),
      ),
    ).toContain("1. **Book of Mormon**");
    expect(extractMorningBriefPresentMarkdown('{"ok":false}')).toBeNull();
  });

  it("formats the user-facing Morning brief setup list", () => {
    const list = formatSetupMarkdown();
    expect(list).toContain("# Morning brief setup");
    expect(list).toContain("1. **Book of Mormon**");
    expect(list).toContain("2. **Come, Follow Me — Deep Study**");
    expect(list).toContain("7. **Top stories (last 12 hours)**");
    expect(list).toContain("8. **St. George local news**");
    expect(list).toContain("9. **Today's Win**");
    expect(list).toContain("10. **Journal Prompt**");
    expect(list).toContain("Morning brief setup");
  });

  it("parses morning brief section picks", () => {
    expect(parseSectionSelection("1, 2, 7, 9")).toEqual({
      kind: "ids",
      ids: ["book_of_mormon", "come_follow_me", "top_stories", "todays_win"],
    });
    expect(parseSectionSelection("all").kind).toBe("all");
    expect(parseSectionSelection("cancel").kind).toBe("cancel");
    expect(looksLikeSectionSelection("1, 7, 9")).toBe(true);
    expect(looksLikeSectionSelection("Book of Mormon and top stories")).toBe(
      true,
    );
    expect(looksLikeSectionSelection("what's on my calendar")).toBe(false);
    expect(looksLikeSectionSelection("I think I'll win the meeting today")).toBe(
      false,
    );
  });

  it("detects morning brief requests", () => {
    expect(isMorningBriefRequest("Morning brief")).toBe(true);
    expect(isMorningBriefRequest("please run my morning ritual")).toBe(true);
    expect(isMorningBriefRequest("what's on my calendar")).toBe(false);
  });

  it("status label for generate_morning_brief", () => {
    expect(friendlyToolStatus("generate_morning_brief")).toMatch(/morning brief/i);
  });

  it("date-anchors market search queries", () => {
    const at = new Date("2026-08-08T14:00:00Z");
    const queries = buildMarketSearchQueries(at);
    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(queries.some((q) => /2026/.test(q))).toBe(true);
    expect(queries.some((q) => /August/i.test(q))).toBe(true);
  });

  it("date-anchors news queries and includes St. George", () => {
    const queries = buildNewsSearchQueries(new Date("2026-08-08T14:00:00Z"));
    expect(queries.some((q) => /last 12 hours/i.test(q))).toBe(true);
    expect(queries.some((q) => /St\. George Utah/i.test(q))).toBe(true);
    expect(queries.some((q) => /August/i.test(q))).toBe(true);
  });

  it("ranks St. George and wire desks above junk news", () => {
    expect(rankNewsUrl("https://www.stgeorgeutah.com/news/foo")).toBeGreaterThan(
      rankNewsUrl("https://apnews.com/article/bar"),
    );
    expect(rankNewsUrl("https://www.msn.com/en-us/news/x")).toBeLessThan(0);
  });

  it("parses news JSON, keeps one St. George story, and formats clickable links", () => {
    const parsed = parseNewsArticlesJson(`
\`\`\`json
{
  "articles": [
    {"title":"Fed holds","source":"AP","url":"https://apnews.com/a","blurb":"Rates unchanged.","stGeorge":false},
    {"title":"Storms","source":"Reuters","url":"https://www.reuters.com/b","blurb":"Weather.","stGeorge":false},
    {"title":"Council vote","source":"The Spectrum","url":"https://www.thespectrum.com/c","blurb":"City hall.","stGeorge":true},
    {"title":"Trade talks","source":"BBC","url":"https://www.bbc.com/d","blurb":"Talks.","stGeorge":false},
    {"title":"Chip bill","source":"Axios","url":"https://www.axios.com/e","blurb":"Congress.","stGeorge":false},
    {"title":"Extra","source":"NPR","url":"https://www.npr.org/f","blurb":"More.","stGeorge":false}
  ]
}
\`\`\`
`);
    const selected = selectNewsArticles(parsed);
    expect(selected).toHaveLength(5);
    expect(selected.filter((a) => a.stGeorge)).toHaveLength(1);
    expect(selected.at(-1)?.url).toContain("thespectrum.com");

    const section = formatNewsSection({
      ok: true,
      dateAnchor: "August 8 2026",
      windowStart: "August 8, 2026, 6:00 AM",
      queries: [],
      articles: selected,
      notes: "",
    });
    expect(section).toContain("## Top stories (last 12 hours)");
    expect(section).toContain("[Council vote](https://www.thespectrum.com/c)");
    expect(section).toContain("St. George");
  });

  it("upserts Top stories just above Today's Win", () => {
    const out = upsertTopStoriesSection(
      "# Morning brief\n\n## Market brief\nTape.\n\n## Today's Win\nWin.\n\n## Journal Prompt\nPrompt.",
      "## Top stories (last 12 hours)\n\n1. [Fed holds](https://apnews.com/a) — AP",
    );
    expect(out.indexOf("Top stories")).toBeLessThan(out.indexOf("Today's Win"));
    expect(out.indexOf("Today's Win")).toBeLessThan(out.indexOf("Journal Prompt"));
    expect(out).toContain("[Fed holds](https://apnews.com/a)");
  });

  it("ranks wire desks above promo junk", () => {
    expect(rankMarketUrl("https://www.reuters.com/markets/us/")).toBeGreaterThan(
      rankMarketUrl("https://www.fool.com/investing/foo/"),
    );
    expect(rankMarketUrl("https://www.reddit.com/r/stocks/")).toBeLessThan(0);
  });

  it("strips HTML and allowlists church hosts", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><script>x()</script>")).toMatch(
      /Hello world/,
    );
    expect(isChurchUrl("https://www.churchofjesuschrist.org/study/manual/x")).toBe(
      true,
    );
    expect(isChurchUrl("https://example.com")).toBe(false);
  });

  it("demotes lesson-page Brickey mislabel off talk and scrubs watch/talk claims", () => {
    const lessonUrl =
      "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/33?lang=eng";
    const fixed = sanitizeMediaItem(
      {
        type: "talk",
        title: "The Judgments of Job",
        url: `${lessonUrl}#p8`,
        note: "Insightful talk by Joseph Brickey on Job's trials and judgments.",
      },
      lessonUrl,
    );
    expect(fixed?.type).toBe("other");
    expect(fixed?.note).toMatch(/by Joseph Brickey/i);
    expect(fixed?.note).not.toMatch(/\btalk by\b/i);
  });

  it("classifies explicit artwork cues on lesson pages as art", () => {
    const lessonUrl =
      "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/33?lang=eng";
    const fixed = sanitizeMediaItem(
      {
        type: "talk",
        title: "The Judgments of Job",
        url: "https://churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/33?lang=eng#p8",
        note: "Artwork by Joseph Brickey.",
      },
      lessonUrl,
    );
    expect(fixed?.type).toBe("art");
  });

  it("scrubs talkish wording from art titles too", () => {
    const lessonUrl =
      "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/33?lang=eng";
    const fixed = sanitizeMediaItem(
      {
        type: "talk",
        title: "Insightful talk — Artwork by Joseph Brickey",
        url: `${lessonUrl}#p8`,
        note: "Job's trials.",
      },
      lessonUrl,
    );
    expect(fixed?.type).toBe("art");
    expect(fixed?.title).toMatch(/Artwork by Joseph Brickey/i);
    expect(fixed?.title).not.toMatch(/\binsightful\s+talk\b/i);
  });

  it("keeps real talk URLs even if notes mention artwork", () => {
    const lessonUrl =
      "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/33?lang=eng";
    const fixed = sanitizeMediaItem(
      {
        type: "talk",
        title: "Think Celestial!",
        url: "https://www.churchofjesuschrist.org/study/general-conference/2023/10/think-celestial?lang=eng",
        note: "Mentions an artist's picture of the Savior.",
      },
      lessonUrl,
    );
    expect(fixed?.type).toBe("talk");
  });

  it("does not treat clerical talk-by notes on lesson anchors as art", () => {
    const lessonUrl =
      "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/33?lang=eng";
    const fixed = sanitizeMediaItem(
      {
        type: "talk",
        title: "Job's faith",
        url: `${lessonUrl}#p12`,
        note: "Quote from a talk by President Nelson.",
      },
      lessonUrl,
    );
    expect(fixed?.type).toBe("other");
  });

  it("does not treat Delivered-by Elder notes on lesson anchors as art", () => {
    const lessonUrl =
      "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/33?lang=eng";
    const fixed = sanitizeMediaItem(
      {
        type: "talk",
        title: "Delivered by Elder Oaks",
        url: `${lessonUrl}#p3`,
        note: "Short excerpt on the lesson page.",
      },
      lessonUrl,
    );
    expect(fixed?.type).toBe("other");
  });

  it("enforces unique media across the week plan", () => {
    const lesson: CfmLesson = {
      lessonKey: "ot-2026-32",
      lessonNumber: "32",
      start: "2026-08-03",
      end: "2026-08-09",
      scriptureBlock: "Esther",
      url: "https://www.churchofjesuschrist.org/study/manual/come-follow-me-for-home-and-church-old-testament-2026/32?lang=eng",
    };
    const base = buildHeuristicWeekPlan(lesson, "2026-08-03");
    const withDupes: WeekPlan = {
      ...base,
      days: base.days.map((d, i) => ({
        ...d,
        media:
          i < 2
            ? [{ type: "talk", title: "By Divine Design", url: "https://example.com/a" }]
            : [],
      })),
      weekSupplemental: [
        { type: "talk", title: "By Divine Design", url: "https://example.com/a" },
        { type: "video", title: "Courage" },
      ],
    };
    const unique = enforceUniqueMedia(withDupes);
    const titles = unique.days.flatMap((d) => d.media.map((m) => m.title));
    expect(titles.filter((t) => t === "By Divine Design")).toHaveLength(1);
    expect(unique.days[0].scriptureFocus).toBe("Esther");
  });

  it("strips Validation Gate without truncating on letter Z", () => {
    const input = [
      "# Morning brief",
      "",
      "## Validation Gate",
      "- CFM Lesson 32",
      "- Zacks is not a preferred source",
      "",
      "## Book of Mormon",
      "Day 105 — Alma 12",
      "",
      "Talk about Zions and Zacks in the body.",
    ].join("\n");
    const out = stripValidationGateSection(input);
    expect(out).not.toContain("Validation Gate");
    expect(out).toContain("## Book of Mormon");
    expect(out).toContain("Zions and Zacks");
  });

  it("stops Validation Gate skip at h1 headings too", () => {
    const out = stripValidationGateSection(
      [
        "## Validation Gate",
        "- meta",
        "",
        "# Book of Mormon",
        "Day 105",
      ].join("\n"),
    );
    expect(out).toContain("# Book of Mormon");
    expect(out).toContain("Day 105");
    expect(out).not.toContain("Validation Gate");
  });

  it("keeps non-heading body after Validation Gate and does not restore a gate-only brief", () => {
    const withBody = stripValidationGateSection(
      ["## Validation Gate", "- meta", "", "Book of Mormon — Day 105"].join("\n"),
    );
    expect(withBody).toBe("Book of Mormon — Day 105");

    const gateOnly = stripValidationGateSection(
      ["## Validation Gate", "- meta only"].join("\n"),
    );
    expect(gateOnly).toBe("");
  });

  it("formats Today's Win context and asks when empty", () => {
    expect(
      formatTodaysWinContext({
        attention: [],
        remainingTasks: [],
        commitments: [],
      }),
    ).toMatch(/What would make today a win/);

    const filled = formatTodaysWinContext({
      attention: [
        {
          category: "Reply Required",
          subject: "Beacon access review",
          summary: "Adam is waiting on the review.",
          recommendedAction: "Review the implementation today.",
          isBlocking: true,
        },
      ],
      remainingTasks: [
        {
          project: "Beacon",
          title: "Finish access implementation review",
          status: "in_progress",
        },
      ],
      commitments: [
        {
          title: "Beacon access",
          content: "Derek committed to reviewing Beacon access this week.",
          importance: "high",
        },
      ],
    });
    expect(filled).toContain("Beacon access review");
    expect(filled).toContain("[Beacon] (in_progress)");
    expect(filled).toContain("Durable commitments");
    expect(
      formatTodaysWinContext({
        attention: [],
        remainingTasks: [],
        commitments: [],
        error: "db down",
      }),
    ).toMatch(/Win context unavailable: db down/);
  });

  it("does not treat heuristic week plans as durable cache hits", () => {
    const lesson: CfmLesson = {
      lessonKey: "ot-2026-32",
      lessonNumber: "32",
      start: "2026-08-03",
      end: "2026-08-09",
      scriptureBlock: "Esther",
      url: "https://www.churchofjesuschrist.org/study/manual/x",
    };
    const heuristic = buildHeuristicWeekPlan(lesson, "2026-08-03");
    expect(heuristic.source).toBe("heuristic");
    expect(isDurableWeekPlan(heuristic)).toBe(false);
    expect(
      isDurableWeekPlan({ ...heuristic, source: "llm", weekSupplemental: [] }),
    ).toBe(true);
    // Legacy empty plan without source is not durable (likely old heuristic).
    expect(isDurableWeekPlan({ ...heuristic, source: undefined })).toBe(false);
    // Legacy rich plan without source is durable (old LLM plan).
    expect(
      isDurableWeekPlan({
        ...heuristic,
        source: undefined,
        weekSupplemental: [{ type: "talk", title: "By Divine Design" }],
      }),
    ).toBe(true);
  });
});
