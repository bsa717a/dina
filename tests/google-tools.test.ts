import { afterEach, describe, expect, it } from "vitest";
import { getGoogleToolDefinitions } from "@/lib/google/tool-definitions";
import { listGoogleToolNames } from "@/lib/google/tools";

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_USER_EMAIL",
  "MS_TENANT_ID",
  "MS_CLIENT_ID",
  "MS_CLIENT_SECRET",
  "MS_USER_EMAIL",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

function stashEnv() {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

afterEach(() => {
  restoreEnv();
});

describe("google tool registration", () => {
  it("exposes shared mail/block tools when only Microsoft is configured", () => {
    stashEnv();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    delete process.env.GOOGLE_USER_EMAIL;
    process.env.MS_TENANT_ID = "t";
    process.env.MS_CLIENT_ID = "c";
    process.env.MS_CLIENT_SECRET = "s";
    process.env.MS_USER_EMAIL = "work@example.com";

    const names = listGoogleToolNames();
    expect(names).toContain("list_mail_accounts");
    expect(names).toContain("block_attention_sender");
    expect(names).not.toContain("gmail_brief_inbox");
  });

  it("exposes gmail/calendar tools when Google is configured", () => {
    stashEnv();
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REFRESH_TOKEN = "refresh";
    process.env.GOOGLE_USER_EMAIL = "me@gmail.com";

    const names = listGoogleToolNames();
    expect(names).toContain("gmail_brief_inbox");
    expect(names).toContain("google_list_calendar_events");
    expect(names).toContain("list_mail_accounts");

    const defs = getGoogleToolDefinitions();
    expect(defs.some((t) => t.name === "gmail_brief_inbox")).toBe(true);
    expect(defs.some((t) => t.name === "brief_inbox")).toBe(false);
  });
});
