import { beforeEach, describe, expect, it, vi } from "vitest";

const conversationCreate = vi.fn();
const conversationFindFirst = vi.fn();
const conversationUpdate = vi.fn();
const messageCreate = vi.fn();
const messageFindUniqueOrThrow = vi.fn();
const attachmentUpdateMany = vi.fn();

vi.mock("@/lib/db/client", () => ({
  prisma: {
    conversation: {
      findFirst: (...args: unknown[]) => conversationFindFirst(...args),
      create: (...args: unknown[]) => conversationCreate(...args),
      update: (...args: unknown[]) => conversationUpdate(...args),
      findUnique: vi.fn(),
    },
    message: {
      create: (...args: unknown[]) => messageCreate(...args),
      findUniqueOrThrow: (...args: unknown[]) => messageFindUniqueOrThrow(...args),
      findMany: vi.fn(),
    },
    attachment: {
      updateMany: (...args: unknown[]) => attachmentUpdateMany(...args),
    },
  },
}));

describe("message persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    conversationFindFirst.mockReset();
    conversationCreate.mockReset();
    conversationUpdate.mockResolvedValue({});
    messageCreate.mockReset();
    messageFindUniqueOrThrow.mockReset();
    attachmentUpdateMany.mockResolvedValue({});
  });

  it("creates a default conversation when none exists", async () => {
    conversationFindFirst.mockResolvedValue(null);
    conversationCreate.mockResolvedValue({ id: "c1", title: "Dina" });
    const { getOrCreateDefaultConversation } = await import("@/lib/db/conversations");
    const conversation = await getOrCreateDefaultConversation("user-1", "Dina");
    expect(conversation.id).toBe("c1");
    expect(conversationCreate).toHaveBeenCalledWith({
      data: { userId: "user-1", title: "Dina" },
    });
  });

  it("persists a message and links attachments", async () => {
    conversationFindFirst.mockResolvedValue({ userId: "user-1" });
    messageCreate.mockResolvedValue({ id: "m1" });
    messageFindUniqueOrThrow.mockResolvedValue({
      id: "m1",
      role: "user",
      content: "hello",
      attachments: [{ id: "a1" }],
    });

    const { createMessage } = await import("@/lib/db/conversations");
    const message = await createMessage({
      conversationId: "c1",
      role: "user",
      content: "hello",
      attachmentIds: ["a1"],
    });

    expect(message.content).toBe("hello");
    expect(attachmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["a1"] },
          messageId: null,
          uploadedByUserId: "user-1",
        },
        data: { messageId: "m1" },
      }),
    );
  });
});
