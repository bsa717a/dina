export type ChatAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  kind?: string;
  previewUrl?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  openaiResponseId?: string | null;
  attachments?: ChatAttachment[];
  pending?: boolean;
};
