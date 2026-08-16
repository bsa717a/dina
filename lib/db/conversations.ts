import { prisma } from "@/lib/db/client";

export const DEFAULT_CONVERSATION_TITLE = "Dina";

export async function getOrCreateDefaultConversation(
  userId: string,
  title = DEFAULT_CONVERSATION_TITLE,
) {
  const existing = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: { userId, title },
  });
}

export async function getConversationWithMessages(input: {
  userId: string;
  conversationId?: string;
  title?: string;
}) {
  const conversation = input.conversationId
    ? await prisma.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
      })
    : await getOrCreateDefaultConversation(
        input.userId,
        input.title ?? DEFAULT_CONVERSATION_TITLE,
      );

  if (!conversation) return null;

  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { attachments: true },
  });

  return { conversation, messages };
}

export async function createMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  openaiResponseId?: string | null;
  attachmentIds?: string[];
}) {
  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      openaiResponseId: input.openaiResponseId ?? null,
    },
  });

  if (input.attachmentIds?.length) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId },
      select: { userId: true },
    });
    await prisma.attachment.updateMany({
      where: {
        id: { in: input.attachmentIds },
        messageId: null,
        uploadedByUserId: conversation?.userId ?? "",
      },
      data: { messageId: message.id },
    });
  }

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { updatedAt: new Date() },
  });

  return prisma.message.findUniqueOrThrow({
    where: { id: message.id },
    include: { attachments: true },
  });
}

export async function listMessagesForProvider(conversationId: string) {
  return prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: { attachments: true },
  });
}

export async function conversationOwnedByUser(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  return Boolean(row);
}
