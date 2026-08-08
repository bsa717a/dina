export type ChatRole = "user" | "assistant" | "system";

export type ProviderAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  kind: "image" | "text" | "pdf" | "other";
  textContent?: string;
  dataUrl?: string;
};

export type ProviderMessage = {
  role: ChatRole;
  content: string;
  attachments?: ProviderAttachment[];
};

export type StreamEvent =
  | { type: "status"; status: string; detail?: string }
  | { type: "delta"; text: string }
  | { type: "done"; responseId?: string; text: string }
  | { type: "error"; message: string };

export interface ModelProvider {
  readonly name: string;
  streamChat(input: {
    messages: ProviderMessage[];
    signal?: AbortSignal;
    /** Structured memory block injected into runtime instructions. */
    memoryBlock?: string;
  }): AsyncIterable<StreamEvent>;
}

/** Extension point: swap providers without rewriting the chat UI. */
export async function getModelProvider(): Promise<ModelProvider> {
  const { OpenAIProvider } = await import("@/lib/ai/openai");
  return new OpenAIProvider();
}
