import { afterEach, describe, expect, it, vi } from "vitest";

describe("microsoft config and tools registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reports not configured when env vars are missing", async () => {
    vi.stubEnv("MS_TENANT_ID", "");
    vi.stubEnv("MS_CLIENT_ID", "");
    vi.stubEnv("MS_CLIENT_SECRET", "");
    vi.stubEnv("MS_USER_EMAIL", "");
    const { isMicrosoftConfigured, getMicrosoftConfig } = await import(
      "@/lib/microsoft/config"
    );
    expect(isMicrosoftConfigured()).toBe(false);
    expect(getMicrosoftConfig()).toBeNull();
  });

  it("loads config from env", async () => {
    vi.stubEnv("MS_TENANT_ID", "tenant");
    vi.stubEnv("MS_CLIENT_ID", "client");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("MS_USER_EMAIL", "derek@4studentlives.com");
    const { isMicrosoftConfigured, getMicrosoftConfig } = await import(
      "@/lib/microsoft/config"
    );
    expect(isMicrosoftConfigured()).toBe(true);
    expect(getMicrosoftConfig()?.userEmail).toBe("derek@4studentlives.com");
  });

  it("exposes a broad Microsoft tool set when configured", async () => {
    vi.stubEnv("MS_TENANT_ID", "tenant");
    vi.stubEnv("MS_CLIENT_ID", "client");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("MS_USER_EMAIL", "derek@4studentlives.com");
    const { getMicrosoftToolDefinitions } = await import(
      "@/lib/microsoft/tool-definitions"
    );
    const tools = getMicrosoftToolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_inbox_messages");
    expect(names).toContain("brief_inbox");
    expect(names).toContain("get_email");
    expect(names).toContain("get_emails");
    expect(names).toContain("mark_matching_emails_read");
    expect(names).toContain("create_inbox_rule");
    expect(names).toContain("list_inbox_rules");
    expect(names).toContain("ensure_mail_folder");
    expect(names).toContain("create_mail_folder");
    expect(names).toContain("list_calendar_events");
    expect(names).toContain("list_planner_plans");
    expect(names).toContain("create_planner_task");
    expect(names).toContain("create_sharepoint_note");
    expect(names).toContain("list_todo_lists");
    expect(names).toContain("list_joined_teams");
  });

  it("returns unknown tool error from executor", async () => {
    const { executeMicrosoftTool } = await import("@/lib/microsoft/tools");
    const result = JSON.parse(await executeMicrosoftTool("not_a_real_tool", "{}"));
    expect(result.ok).toBe(false);
  });
});
