import { afterEach, describe, expect, it } from "vitest";
import { getMicrosoftToolDefinitions } from "@/lib/microsoft/tool-definitions";
import { listMicrosoftToolNames } from "@/lib/microsoft/tools";

const ENV_KEYS = [
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

describe("work mail account tools", () => {
  it("exposes account and block tools when Microsoft is configured", () => {
    stashEnv();
    process.env.MS_TENANT_ID = "t";
    process.env.MS_CLIENT_ID = "c";
    process.env.MS_CLIENT_SECRET = "s";
    process.env.MS_USER_EMAIL = "work@example.com";

    const names = listMicrosoftToolNames();
    expect(names).toContain("list_mail_accounts");
    expect(names).toContain("block_attention_sender");
    expect(names).not.toContain("gmail_brief_inbox");
    expect(names).not.toContain("google_list_calendar_events");

    const defs = getMicrosoftToolDefinitions();
    expect(defs.some((tool) => tool.name === "list_mail_accounts")).toBe(true);
    expect(defs.some((tool) => tool.name === "brief_inbox")).toBe(true);
    expect(defs.some((tool) => tool.name === "gmail_brief_inbox")).toBe(false);
  });

  it("hides Microsoft tools when Microsoft is not configured", () => {
    stashEnv();
    delete process.env.MS_TENANT_ID;
    delete process.env.MS_CLIENT_ID;
    delete process.env.MS_CLIENT_SECRET;
    delete process.env.MS_USER_EMAIL;

    expect(getMicrosoftToolDefinitions()).toEqual([]);
  });
});
