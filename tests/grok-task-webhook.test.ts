import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const getGrokBotConfig = vi.fn();
const isGrokBotConfigured = vi.fn();

vi.mock("@/lib/telnyx/config", () => ({
  getGrokBotConfig: () => getGrokBotConfig(),
  isGrokBotConfigured: () => isGrokBotConfigured(),
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

  it("includes signature when webhook secret is set", async () => {
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
});
