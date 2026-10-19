import { describe, expect, it } from "vitest";
import {
  CLIFFS_MAMA_KEYWORD_REPLIES,
  CLIFFS_MAMA_RCS_AGENT_ID,
  keywordRepliesForAgent,
  matchTelnyxKeyword,
  normalizeKeywordText,
  TELNYX_KEYWORD_REPLIES,
} from "@/lib/telnyx/keywords";
import { isRcsMessageType } from "@/lib/telnyx/inbound";

const FOUR_SL_AGENT_ID = "42257dc9-586a-4f72-bba3-6b816d1ec6ed";

describe("TELNYX_KEYWORD_REPLIES", () => {
  it("keeps the registered 4StudentLives HELP and START wording", () => {
    expect(TELNYX_KEYWORD_REPLIES.help).toBe(
      "4StudentLives: For help, reply HELP or contact us at +14352382071. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out.",
    );
    expect(TELNYX_KEYWORD_REPLIES.start).toBe(
      "You have agreed to receive SMS updates from 4StudentLives. Msg freq may vary. Std msg & data rates apply. Reply STOP to opt out, HELP for help.",
    );
  });

  it("names 4StudentLives in the STOP reply", () => {
    expect(TELNYX_KEYWORD_REPLIES.stop).toBe(
      "You have successfully been unsubscribed from texts from 4StudentLives, you will not receive any more messages from this number. Reply START to re-subscribe.",
    );
  });
});

describe("Cliffs Mama keyword replies", () => {
  it("uses the Cliffs Mama RCS agent id as the brand key", () => {
    expect(CLIFFS_MAMA_RCS_AGENT_ID).toBe(
      "1f2bf18b-a131-4429-8171-58e5202d4a39",
    );
    expect(keywordRepliesForAgent(CLIFFS_MAMA_RCS_AGENT_ID)).toBe(
      CLIFFS_MAMA_KEYWORD_REPLIES,
    );
  });

  it("names Clif's Mama in STOP and points HELP at the privacy and terms pages", () => {
    expect(CLIFFS_MAMA_KEYWORD_REPLIES.stop).toBe(
      "You have successfully been unsubscribed from texts from Clif's Mama, you will not receive any more messages from this number. Reply START to re-subscribe.",
    );
    expect(CLIFFS_MAMA_KEYWORD_REPLIES.help).toBe(
      "Clif's Mama: For help, reply HELP or see our privacy policy at https://www.clifsmama.com/privacy.html and terms at https://www.clifsmama.com/terms.html. Msg frequency varies. Msg&data rates may apply. Reply STOP to opt out.",
    );
    expect(CLIFFS_MAMA_KEYWORD_REPLIES.help).toContain(
      "https://www.clifsmama.com/privacy.html",
    );
    expect(CLIFFS_MAMA_KEYWORD_REPLIES.help).toContain(
      "https://www.clifsmama.com/terms.html",
    );
    expect(CLIFFS_MAMA_KEYWORD_REPLIES.help).not.toContain("4StudentLives");
    expect(CLIFFS_MAMA_KEYWORD_REPLIES.help).not.toContain("+14352382071");
  });

  it("keeps the 4StudentLives START shape with the Clif's Mama program name", () => {
    expect(CLIFFS_MAMA_KEYWORD_REPLIES.start).toBe(
      "You have agreed to receive SMS updates from Clif's Mama. Msg freq may vary. Std msg & data rates apply. Reply STOP to opt out, HELP for help.",
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

  it("uses Clif's Mama copy for that RCS agent, including STOPALL and the other opt-out aliases", () => {
    expect(matchTelnyxKeyword("HELP", CLIFFS_MAMA_RCS_AGENT_ID)).toEqual({
      kind: "help",
      text: CLIFFS_MAMA_KEYWORD_REPLIES.help,
    });
    expect(matchTelnyxKeyword("info!", CLIFFS_MAMA_RCS_AGENT_ID)).toEqual({
      kind: "help",
      text: CLIFFS_MAMA_KEYWORD_REPLIES.help,
    });
    expect(matchTelnyxKeyword("START", CLIFFS_MAMA_RCS_AGENT_ID)).toEqual({
      kind: "start",
      text: CLIFFS_MAMA_KEYWORD_REPLIES.start,
    });
    expect(matchTelnyxKeyword("unstop", CLIFFS_MAMA_RCS_AGENT_ID)?.text).toBe(
      CLIFFS_MAMA_KEYWORD_REPLIES.start,
    );

    for (const text of [
      "STOP",
      "STOPALL",
      "stopall!",
      "unsubscribe",
      "Cancel",
      "END",
      "quit",
    ]) {
      expect(matchTelnyxKeyword(text, CLIFFS_MAMA_RCS_AGENT_ID)).toEqual({
        kind: "stop",
        text: CLIFFS_MAMA_KEYWORD_REPLIES.stop,
      });
    }
  });

  it("matches the Cliffs Mama agent id regardless of case or surrounding space", () => {
    const mixedCase = `  ${CLIFFS_MAMA_RCS_AGENT_ID.toUpperCase()}  `;
    expect(matchTelnyxKeyword("STOP", mixedCase)?.text).toBe(
      CLIFFS_MAMA_KEYWORD_REPLIES.stop,
    );
  });

  it("falls back to 4StudentLives for an unknown agent, the 4SL agent, or no agent", () => {
    for (const agentId of [
      undefined,
      null,
      "",
      "   ",
      FOUR_SL_AGENT_ID,
      "not-a-known-agent",
      "4001a055-5081-43e2-8b5e-d41eb0cf866e",
    ]) {
      expect(keywordRepliesForAgent(agentId)).toBe(TELNYX_KEYWORD_REPLIES);
      expect(matchTelnyxKeyword("HELP", agentId)?.text).toBe(
        TELNYX_KEYWORD_REPLIES.help,
      );
      expect(matchTelnyxKeyword("STOPALL", agentId)?.text).toBe(
        TELNYX_KEYWORD_REPLIES.stop,
      );
      expect(matchTelnyxKeyword("START", agentId)?.text).toBe(
        TELNYX_KEYWORD_REPLIES.start,
      );
    }
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
