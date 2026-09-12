import { describe, expect, it } from "vitest";
import {
  extractInboundFromPhone,
  extractInboundText,
  extractInboundTo,
  normalizeInboundMessage,
} from "@/lib/telnyx/inbound";

describe("extractInboundText", () => {
  it("returns a plain SMS string unchanged", () => {
    expect(extractInboundText("Help")).toBe("Help");
    expect(extractInboundText("Hello Dina!")).toBe("Hello Dina!");
  });

  it("extracts text from RCS { text: \"...\" } object", () => {
    expect(extractInboundText({ text: "Help" })).toBe("Help");
  });

  it("extracts text from JSON string {\"text\":\"Help\"}", () => {
    expect(extractInboundText('{"text":"Help"}')).toBe("Help");
  });

  it("extracts Telnyx RCS body.text from the full payload", () => {
    expect(
      extractInboundText({
        body: { text: "Help" },
        direction: "inbound",
        type: "RCS",
      }),
    ).toBe("Help");
  });

  it("extracts RCS suggestion_response text", () => {
    expect(
      extractInboundText({
        body: {
          suggestion_response: {
            postback_data: "help",
            text: "Help",
          },
        },
      }),
    ).toBe("Help");
  });

  it("returns empty string for missing or non-text RCS bodies", () => {
    expect(extractInboundText(undefined)).toBe("");
    expect(extractInboundText(null)).toBe("");
    expect(extractInboundText({ body: { location: { latitude: 1 } } })).toBe("");
  });

  it("keeps literal SMS that looks like JSON but has no text field", () => {
    expect(extractInboundText('{"foo":"bar"}')).toBe('{"foo":"bar"}');
  });
});

describe("extractInboundFromPhone / extractInboundTo", () => {
  it("reads SMS from.phone_number and to[].phone_number", () => {
    const payload = {
      from: { phone_number: "+19044030781" },
      to: [{ phone_number: "+18005551234" }],
    };
    expect(extractInboundFromPhone(payload)).toBe("+19044030781");
    expect(extractInboundTo(payload)).toBe("+18005551234");
  });

  it("falls back to RCS to[].agent_id when there is no phone", () => {
    expect(
      extractInboundTo({
        to: [
          {
            agent_id: "42257dc9-586a-4f72-bba3-6b816d1ec6ed",
            agent_name: "dina_4n1bd8jt_agent",
          },
        ],
      }),
    ).toBe("42257dc9-586a-4f72-bba3-6b816d1ec6ed");
  });

  it("accepts a bare from string", () => {
    expect(extractInboundFromPhone({ from: "+19044030781" })).toBe(
      "+19044030781",
    );
  });

  it("returns empty strings instead of throwing on missing addresses", () => {
    expect(extractInboundFromPhone({})).toBe("");
    expect(extractInboundTo({})).toBe("");
    expect(extractInboundFromPhone(undefined)).toBe("");
  });
});

describe("normalizeInboundMessage", () => {
  it("normalizes official RCS inbound (body.text, agent to)", () => {
    const normalized = normalizeInboundMessage(
      {
        body: { text: "Help" },
        direction: "inbound",
        from: {
          carrier: "T-Mobile USA",
          line_type: "long_code",
          phone_number: "+19044030781",
        },
        id: "d5b48ae4-91a9-4a5f-8a6d-756060c1cf32",
        to: [
          {
            agent_id: "42257dc9-586a-4f72-bba3-6b816d1ec6ed",
            agent_name: "dina_4n1bd8jt_agent",
          },
        ],
        type: "RCS",
      },
      "2026-09-12T02:35:50Z",
    );

    expect(normalized).not.toBeNull();
    expect(normalized?.text).toBe("Help");
    expect(typeof normalized?.text).toBe("string");
    expect(normalized?.from.phone_number).toBe("+19044030781");
    expect(normalized?.to[0]?.agent_id).toBe(
      "42257dc9-586a-4f72-bba3-6b816d1ec6ed",
    );
    expect(normalized?.type).toBe("RCS");
    expect(normalized?.received_at).toBe("2026-09-12T02:35:50Z");
  });

  it("normalizes SMS inbound string text", () => {
    const normalized = normalizeInboundMessage({
      id: "sms-1",
      direction: "inbound",
      type: "SMS",
      text: "Help",
      from: { phone_number: "+19044030781", carrier: "", line_type: "" },
      to: [{ phone_number: "+18005551234", carrier: "", line_type: "" }],
    });

    expect(normalized?.text).toBe("Help");
    expect(normalized?.type).toBe("SMS");
    expect(normalized?.to[0]?.phone_number).toBe("+18005551234");
  });

  it("coerces JSON-string text to the inner user text", () => {
    const normalized = normalizeInboundMessage({
      id: "rcs-json-text",
      direction: "inbound",
      type: "RCS",
      text: '{"text":"Help"}',
      from: { phone_number: "+19044030781" },
    });

    expect(normalized?.text).toBe("Help");
  });

  it("returns null when the message id is missing", () => {
    expect(normalizeInboundMessage({ text: "Help" })).toBeNull();
    expect(normalizeInboundMessage(null)).toBeNull();
  });
});
