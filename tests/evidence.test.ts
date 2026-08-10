import { describe, expect, it } from "vitest";
import {
  evidenceDomainsForQuestion,
  evidenceToolSucceeded,
  isEvidenceTool,
  looksLikeHonestUncertainty,
  looksLikeUnverifiedLiveClaim,
  allRequiredDomainsMet,
  toolSatisfiesDomains,
} from "@/lib/ai/evidence";
import {
  getOpenAIChatModel,
  getOpenAIResearchModel,
} from "@/lib/env";
import {
  isEmailQuestion,
  isGitHubQuestion,
  requiresLiveEvidence,
} from "@/lib/ai/tool-routing";

describe("evidence helpers", () => {
  it("treats brief_inbox and church search as evidence tools", () => {
    expect(isEvidenceTool("brief_inbox")).toBe(true);
    expect(isEvidenceTool("search_church_site")).toBe(true);
    expect(isEvidenceTool("send_email")).toBe(false);
  });

  it("parses ok from tool JSON", () => {
    expect(evidenceToolSucceeded(JSON.stringify({ ok: true }))).toBe(true);
    expect(evidenceToolSucceeded(JSON.stringify({ ok: false }))).toBe(false);
  });

  it("detects honest uncertainty vs invented live claims", () => {
    expect(
      looksLikeHonestUncertainty(
        "I cannot verify that — brief_inbox failed. Want me to retry?",
      ),
    ).toBe(true);
    expect(
      looksLikeUnverifiedLiveClaim(
        "You have a meeting with Breck at 2:00 PM and three unread emails.",
      ),
    ).toBe(true);
    expect(
      looksLikeUnverifiedLiveClaim(
        "I don't have live calendar data yet — not connected.",
      ),
    ).toBe(false);
    // Bare clock time is not a live claim.
    expect(
      looksLikeUnverifiedLiveClaim("Let's talk at 2:00 PM if that works."),
    ).toBe(false);
  });

  it("requires domain-matching tools for evidence asks", () => {
    expect(evidenceDomainsForQuestion("brief my inbox")).toContain("mail");
    expect(evidenceDomainsForQuestion("talk about my calendar")).toEqual([
      "calendar",
    ]);
    expect(toolSatisfiesDomains("search_memory", ["mail"])).toBe(false);
    expect(toolSatisfiesDomains("brief_inbox", ["mail"])).toBe(true);
    expect(toolSatisfiesDomains("list_calendar_events", ["calendar"])).toBe(
      true,
    );
    expect(toolSatisfiesDomains("search_memory", [])).toBe(false);
    expect(
      allRequiredDomainsMet(new Set(["mail"]), ["mail", "calendar"]),
    ).toBe(false);
    expect(
      allRequiredDomainsMet(new Set(["mail", "calendar"]), ["mail", "calendar"]),
    ).toBe(true);
  });
});

describe("live-evidence routing", () => {
  it("flags email and github asks", () => {
    expect(isEmailQuestion("brief my inbox")).toBe(true);
    expect(isGitHubQuestion("any failed GitHub workflows?")).toBe(true);
    expect(requiresLiveEvidence("what's on my calendar today")).toBe(true);
    expect(requiresLiveEvidence("how are you")).toBe(false);
  });
});

describe("model routing defaults", () => {
  it("defaults chat to nano and research to gpt-4.1 when unset", () => {
    const prevChat = process.env.OPENAI_MODEL_CHAT;
    const prevResearch = process.env.OPENAI_MODEL_RESEARCH;
    const prevLegacy = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_CHAT;
    delete process.env.OPENAI_MODEL_RESEARCH;
    delete process.env.OPENAI_MODEL;
    try {
      expect(getOpenAIChatModel()).toBe("gpt-4.1-nano");
      expect(getOpenAIResearchModel()).toBe("gpt-4.1");
    } finally {
      if (prevChat === undefined) delete process.env.OPENAI_MODEL_CHAT;
      else process.env.OPENAI_MODEL_CHAT = prevChat;
      if (prevResearch === undefined) delete process.env.OPENAI_MODEL_RESEARCH;
      else process.env.OPENAI_MODEL_RESEARCH = prevResearch;
      if (prevLegacy === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = prevLegacy;
    }
  });
});
