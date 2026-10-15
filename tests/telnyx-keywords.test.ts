import { describe, expect, it } from "vitest";
import {
  matchTelnyxKeyword,
  normalizeKeywordText,
  TELNYX_KEYWORD_REPLIES,
} from "@/lib/telnyx/keywords";
import { isRcsMessageType } from "@/lib/telnyx/inbound";

describe("TELNYX_KEYWORD_REPLIES", () => {
  it("keeps the registered HELP and START wording and the required STOP reply", () => {
    expect(TELNYX_KEYWORD_REPLIES.help).toBe(
      "4StudentLives: For help, reply HELP or contact us at +14352382071. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out.",
    );
    expect(TELNYX_KEYWORD_REPLIES.stop).toBe(
      "You have successfully been unsubscribed, you will not receive any more messages from this number. Reply START to re-subscribe.",
    );
    expect(TELNYX_KEYWORD_REPLIES.start).toBe(
      "You have agreed to receive SMS updates from 4StudentLives. Msg freq may vary. Std msg & data rates apply. Reply STOP to opt out, HELP for help.",
    );
  });
});

describe("matchTelnyxKeyword", () => {
  it("matches HELP and INFO regardless of case or trailing punctuation", () => {
    for (const text of ["Help", "HELP", "help!", "INFO", "info."]) {
      expect(matchTelnyxKeyword(text)).toEqual({
        kind: "help",
        text: TELNYX_KEYWORD_REPLIES.help,
      });
    }
  });

  it("matches STOP and STOPALL regardless of case or surrounding punctuation", () => {
    for (const text of [
      "STOP",
      "stop!",
      "Stop.",
      "  STOP?  ",
      "STOPALL",
      "stopall",
      "StopAll!",
      "stopall.",
      "  STOPALL?  ",
    ]) {
      expect(matchTelnyxKeyword(text)).toEqual({
        kind: "stop",
        text: TELNYX_KEYWORD_REPLIES.stop,
      });
    }
  });

  it("matches other STOP aliases with the same opt-out reply", () => {
    for (const text of ["unsubscribe", "Cancel", "END", "quit"]) {
      expect(matchTelnyxKeyword(text)).toEqual({
        kind: "stop",
        text: TELNYX_KEYWORD_REPLIES.stop,
      });
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
