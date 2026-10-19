import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const getGrokBotConfig = vi.fn();
const isGrokBotConfigured = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/telnyx/config", () => ({
  getGrokBotConfig: () => getGrokBotConfig(),
  isGrokBotConfigured: () => isGrokBotConfigured(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    projectMember: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const createTaskChangePayload = () => ({
  event: "task.updated" as const,
  projectKey: "4sl",
  task: {
    id: "task-1",
    number: 2,
    title: "Test task",
    description: "A test task",
    status: "done" as const,
  },
  changes: {
    status: "done" as const,
  },
});

describe("notifyTaskChange", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    getGrokBotConfig.mockReset();
    isGrokBotConfigured.mockReset();
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it("logs when Grok Bot is not configured", async () => {
    isGrokBotConfigured.mockReturnValue(false);
    getGrokBotConfig.mockReturnValue(null);

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    const result = await notifyTaskChange(createTaskChangePayload());

    expect(result.status).toBe("logged");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends to Grok Bot when configured", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    const result = await notifyTaskChange(createTaskChangePayload());

    expect(result.status).toBe("sent");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://grok-bot.example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.type).toBe("task.updated");
    expect(body.projectKey).toBe("4sl");
    expect(body.task.id).toBe("task-1");
    expect(body.task.number).toBe(2);
    expect(body.task.status).toBe("done");
    expect(body.changes.status).toBe("done");
    expect(body.timestamp).toBeDefined();
  });

  it("sends Bearer and X-Automation-Key when webhook secret is set", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: "test-secret",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    await notifyTaskChange(createTaskChangePayload());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-secret",
          "X-Automation-Key": "test-secret",
          "X-Grok-Bot-Signature": expect.any(String),
          "X-Grok-Bot-Timestamp": expect.any(String),
        }),
      }),
    );
  });

  it("handles Grok Bot errors gracefully", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    const result = await notifyTaskChange(createTaskChangePayload());

    expect(result.status).toBe("error");
    expect(result.error).toContain("500");
  });

  it("handles network errors gracefully", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    const result = await notifyTaskChange(createTaskChangePayload());

    expect(result.status).toBe("error");
    expect(result.error).toBe("Network error");
  });

  it("sends task.created events correctly", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    await notifyTaskChange({
      event: "task.created",
      projectKey: "dina",
      task: {
        id: "new-task",
        number: 5,
        title: "New task",
        description: "Created via API",
        status: "open",
      },
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.type).toBe("task.created");
    expect(body.projectKey).toBe("dina");
    expect(body.task.title).toBe("New task");
  });

  it("includes assignee on the webhook task and on changes", async () => {
    isGrokBotConfigured.mockReturnValue(true);
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://grok-bot.example.com/webhook",
      webhookSecret: null,
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    await notifyTaskChange({
      event: "task.updated",
      projectKey: "4sl",
      task: {
        id: "task-1",
        number: 2,
        title: "Test task",
        description: "A test task",
        status: "open",
        assignee: { email: "adam@example.com", name: "Adam Smith" },
      },
      changes: {
        assignee: null,
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.task.assignee).toEqual({
      email: "adam@example.com",
      name: "Adam Smith",
    });
    expect(body.changes.assignee).toBeNull();
    expect(body.task.status).toBe("open");
  });

  it("sends each member bot once and skips the env bot when everyone has one", async () => {
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://dina.example/webhook",
      webhookSecret: "dina-secret",
    });
    findMany.mockResolvedValue([
      {
        userId: "adam",
        user: { grokWebhookUrl: "https://adam.example/webhook", grokWebhookSecret: null },
      },
      {
        userId: "alex",
        user: { grokWebhookUrl: "https://alex.example/webhook", grokWebhookSecret: null },
      },
      {
        userId: "adam-again",
        user: { grokWebhookUrl: "https://adam.example/webhook", grokWebhookSecret: null },
      },
    ]);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    const result = await notifyTaskChange(createTaskChangePayload());

    expect(result.status).toBe("sent");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([
      "https://adam.example/webhook",
      "https://alex.example/webhook",
    ]);
  });

  it("sends the env bot once when every member lacks a bot", async () => {
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://dina.example/webhook",
      webhookSecret: "dina-secret",
    });
    findMany.mockResolvedValue([
      { userId: "pat", user: { grokWebhookUrl: null, grokWebhookSecret: null } },
      { userId: "sam", user: { grokWebhookUrl: "", grokWebhookSecret: null } },
    ]);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    const result = await notifyTaskChange(createTaskChangePayload());

    expect(result.status).toBe("sent");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://dina.example/webhook");
  });

  it("falls back to Dina once when several members have no bot", async () => {
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://dina.example/webhook",
      webhookSecret: "dina-secret",
    });
    findMany.mockResolvedValue([
      {
        userId: "adam",
        user: { grokWebhookUrl: "https://adam.example/webhook", grokWebhookSecret: null },
      },
      { userId: "pat", user: { grokWebhookUrl: null, grokWebhookSecret: null } },
      { userId: "sam", user: { grokWebhookUrl: "  ", grokWebhookSecret: null } },
    ]);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    await notifyTaskChange(createTaskChangePayload());

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls.map((call) => call[0])).toEqual([
      "https://adam.example/webhook",
      "https://dina.example/webhook",
    ]);
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe("Bearer dina-secret");
  });

  it("does not send the env bot twice when a member already uses that URL", async () => {
    getGrokBotConfig.mockReturnValue({
      webhookUrl: "https://dina.example/webhook",
      webhookSecret: "dina-secret",
    });
    findMany.mockResolvedValue([
      {
        userId: "adam",
        user: {
          grokWebhookUrl: "https://dina.example/webhook",
          grokWebhookSecret: null,
        },
      },
      { userId: "pat", user: { grokWebhookUrl: null, grokWebhookSecret: null } },
    ]);
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
    await notifyTaskChange(createTaskChangePayload());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://dina.example/webhook");
  });

  it("decrypts a member webhook secret before sending", async () => {
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "test-session-secret-test-session-secret";
    try {
      getGrokBotConfig.mockReturnValue(null);
      const { encryptField } = await import("@/lib/crypto/field-cipher");
      findMany.mockResolvedValue([
        {
          userId: "adam",
          user: {
            grokWebhookUrl: "https://adam.example/webhook",
            grokWebhookSecret: encryptField("crsr_adam"),
          },
        },
      ]);
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

      const { notifyTaskChange } = await import("@/lib/grok-api/task-webhook");
      const result = await notifyTaskChange(createTaskChangePayload());

      expect(result.status).toBe("sent");
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer crsr_adam");
      expect(mockFetch.mock.calls[0][1].headers["X-Automation-Key"]).toBe("crsr_adam");
      expect(JSON.stringify(mockFetch.mock.calls[0][1].headers)).not.toContain("aes-256-gcm");
    } finally {
      if (previous === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = previous;
    }
  });
});
