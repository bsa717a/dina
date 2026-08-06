import { prisma } from "@/lib/db/client";

export const DEFAULT_CONVERSATION_TITLE = "Dina";

export async function getOrCreateDefaultConversation() {
  const existing = await prisma.conversation.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return prisma.conversation.create({
    data: { title: DEFAULT_CONVERSATION_TITLE },
  });
}

export async function getConversationWithMessages(conversationId?: string) {
  const conversation = conversationId
    ? await prisma.conversation.findUnique({ where: { id: conversationId } })
    : await getOrCreateDefaultConversation();

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
    await prisma.attachment.updateMany({
      where: { id: { in: input.attachmentIds }, messageId: null },
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
