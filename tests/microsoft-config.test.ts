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
    expect(names).toContain("list_my_planner_tasks");
    expect(names).toContain("create_planner_task");
    expect(names).toContain("list_onedrive_children");
    expect(names).toContain("search_onedrive");
    expect(names).toContain("get_onedrive_item");
    expect(names).toContain("get_onedrive_file_content");
    expect(names).toContain("create_onedrive_folder");
    expect(names).toContain("write_onedrive_file");
    expect(names).toContain("delete_onedrive_item");
    expect(names).toContain("move_onedrive_item");
    expect(names).toContain("copy_onedrive_item");
    expect(names).toContain("create_word_document");
    expect(names).toContain("create_excel_workbook");
    expect(names).toContain("create_powerpoint_presentation");
    expect(names).toContain("read_word_document");
    expect(names).toContain("read_excel_workbook");
    expect(names).toContain("read_powerpoint_presentation");
    expect(names).toContain("create_email_draft");
    expect(names).toContain("list_mail_attachments");
    expect(names).toContain("get_mail_attachment");
    expect(names).toContain("respond_calendar_event");
    expect(names).toContain("get_planner_task");
    expect(names).toContain("delete_planner_task");
    expect(names).toContain("set_planner_task_details");
    expect(names).toContain("create_sharepoint_note");
    expect(names).toContain("list_sharepoint_folder");
    expect(names).toContain("list_sharepoint_lists");
    expect(names).toContain("get_sharepoint_list_items");
    expect(names).toContain("list_todo_lists");
    expect(names).toContain("list_joined_teams");
    expect(names).toContain("list_channel_messages");
    expect(names).toContain("reply_channel_message");
  });

  it("returns unknown tool error from executor", async () => {
    const { executeMicrosoftTool } = await import("@/lib/microsoft/tools");
    const result = JSON.parse(await executeMicrosoftTool("not_a_real_tool", "{}"));
    expect(result.ok).toBe(false);
  });

  it("refuses write_onedrive_file for Office extensions", async () => {
    vi.stubEnv("MS_TENANT_ID", "tenant");
    vi.stubEnv("MS_CLIENT_ID", "client");
    vi.stubEnv("MS_CLIENT_SECRET", "secret");
    vi.stubEnv("MS_USER_EMAIL", "derek@4studentlives.com");
    const { executeMicrosoftTool } = await import("@/lib/microsoft/tools");
    const result = JSON.parse(
      await executeMicrosoftTool(
        "write_onedrive_file",
        JSON.stringify({
          path: "EQ Temple Lesson.docx",
          content: "plain text that would corrupt a docx",
        }),
      ),
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/create_word_document/i);
  });
});
