import { describe, expect, it } from "vitest";
import {
  annotateCitationToolOutput,
  churchToolSucceeded,
  isChurchCitationTool,
} from "@/lib/church/citation-receipts";
import { isChurchUrl } from "@/lib/morning-ritual/fetch";
import {
  friendlyToolStatus,
  isChurchCitationQuestion,
  looksLikeUnverifiedChurchCitation,
} from "@/lib/ai/tool-routing";

describe("church citation routing", () => {
  it("detects talk / lesson citation asks", () => {
    expect(
      isChurchCitationQuestion(
        "Find me a General Conference talk about temple covenants for the lesson",
      ),
    ).toBe(true);
    expect(
      isChurchCitationQuestion("suggest a talk about repentance for EQ"),
    ).toBe(true);
    expect(
      isChurchCitationQuestion("look up a Nelson quote on covenants"),
    ).toBe(true);
    expect(isChurchCitationQuestion("what's on my calendar today")).toBe(
      false,
    );
    expect(isChurchCitationQuestion("Morning brief")).toBe(false);
  });

  it("detects unverified citation-shaped replies", () => {
    expect(
      looksLikeUnverifiedChurchCitation(
        'Elder James R. Whitaker taught in his 2019 talk "Covenant Paths of Light" that…',
      ),
    ).toBe(true);
    expect(
      looksLikeUnverifiedChurchCitation("Document updated on OneDrive."),
    ).toBe(false);
  });

  it("maps church tools to friendly status", () => {
    expect(friendlyToolStatus("search_church_site")).toMatch(/Church/i);
    expect(friendlyToolStatus("fetch_church_url")).toMatch(/Church/i);
  });
});

describe("church citation receipts", () => {
  it("recognizes church citation tools", () => {
    expect(isChurchCitationTool("search_church_site")).toBe(true);
    expect(isChurchCitationTool("fetch_church_url")).toBe(true);
    expect(isChurchCitationTool("brief_inbox")).toBe(false);
  });

  it("annotates successful citation tool output", () => {
    const out = annotateCitationToolOutput(
      "search_church_site",
      JSON.stringify({
        ok: true,
        data: { pages: [{ url: "https://www.churchofjesuschrist.org/x" }] },
      }),
    );
    const parsed = JSON.parse(out) as { ok: boolean; instruction: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.instruction).toMatch(/CITATION RECEIPT/);
    expect(parsed.instruction).toMatch(/SUCCEEDED/);
    expect(churchToolSucceeded(out)).toBe(true);
  });

  it("annotates failed citation tool output and forbids invention", () => {
    const out = annotateCitationToolOutput(
      "fetch_church_url",
      JSON.stringify({ ok: false, error: "not found" }),
    );
    const parsed = JSON.parse(out) as { ok: boolean; instruction: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.instruction).toMatch(/FAILED/);
    expect(parsed.instruction).toMatch(/Do NOT invent/);
    expect(churchToolSucceeded(out)).toBe(false);
  });

  it("leaves non-church tools unchanged", () => {
    const raw = JSON.stringify({ ok: true, data: {} });
    expect(annotateCitationToolOutput("brief_inbox", raw)).toBe(raw);
  });
});

describe("church URL allowlist", () => {
  it("allows only churchofjesuschrist.org", () => {
    expect(
      isChurchUrl(
        "https://www.churchofjesuschrist.org/study/general-conference/2024/04/example",
      ),
    ).toBe(true);
    expect(isChurchUrl("https://example.com/talk")).toBe(false);
  });
});
