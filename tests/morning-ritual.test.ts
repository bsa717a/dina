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
  buildHeuristicWeekPlan,
  enforceUniqueMedia,
  isDurableWeekPlan,
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
