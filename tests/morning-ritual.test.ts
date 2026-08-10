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
import { stripValidationGateSection } from "@/lib/morning-ritual/compose";
import {
  buildHeuristicWeekPlan,
  enforceUniqueMedia,
  isDurableWeekPlan,
  sanitizeMediaItem,
} from "@/lib/morning-ritual/week-plan";
import type { CfmLesson, WeekPlan } from "@/lib/morning-ritual/types";

describe("morning ritual routing and helpers", () => {
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

  it("reclassifies lesson-page art mislabeled as a talk", () => {
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
    expect(fixed?.type).toBe("art");
    expect(fixed?.note).toMatch(/Artwork by Joseph Brickey/i);
    expect(fixed?.note).not.toMatch(/\btalk by\b/i);
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
