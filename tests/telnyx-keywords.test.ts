import { describe, expect, it } from "vitest";
import {
  matchTelnyxKeyword,
  normalizeKeywordText,
  TELNYX_KEYWORD_REPLIES,
} from "@/lib/telnyx/keywords";
import { isRcsMessageType } from "@/lib/telnyx/inbound";

describe("matchTelnyxKeyword", () => {
  it("matches HELP and INFO regardless of case or trailing punctuation", () => {
    for (const text of ["Help", "HELP", "help!", "INFO", "info."]) {
      expect(matchTelnyxKeyword(text)).toEqual({
        kind: "help",
        text: TELNYX_KEYWORD_REPLIES.help,
      });
    }
  });

  it("matches STOP aliases", () => {
    for (const text of ["STOP", "unsubscribe", "Cancel", "END", "quit"]) {
      expect(matchTelnyxKeyword(text)?.kind).toBe("stop");
    }
  });

  it("matches START aliases but not conversational yes", () => {
    expect(matchTelnyxKeyword("START")?.kind).toBe("start");
    expect(matchTelnyxKeyword("unstop")?.kind).toBe("start");
    expect(matchTelnyxKeyword("yes")).toBeNull();
  });

  it("leaves conversational traffic unmatched", () => {
    expect(matchTelnyxKeyword("Help me with the roster")).toBeNull();
    expect(matchTelnyxKeyword("What is the 4SL backlog?")).toBeNull();
    expect(matchTelnyxKeyword("")).toBeNull();
    expect(matchTelnyxKeyword("   ")).toBeNull();
  });

  it("normalizes keyword text by trimming and stripping punctuation", () => {
    expect(normalizeKeywordText("  HELP!!!  ")).toBe("help");
  });
});

describe("isRcsMessageType", () => {
  it("treats rcs and RCS as RCS", () => {
    expect(isRcsMessageType("rcs")).toBe(true);
    expect(isRcsMessageType("RCS")).toBe(true);
    expect(isRcsMessageType("SMS")).toBe(false);
    expect(isRcsMessageType("MMS")).toBe(false);
    expect(isRcsMessageType(undefined)).toBe(false);
  });
});
