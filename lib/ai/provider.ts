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

export type StreamUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estUsd: number;
  model?: string;
};

export type StreamEvent =
  | { type: "status"; status: string; detail?: string }
  | { type: "delta"; text: string }
  | {
      type: "done";
      responseId?: string;
      text: string;
      usage?: StreamUsage;
    }
  | { type: "error"; message: string };

export type ChatActor = {
  id: string;
  name: string;
  role: "owner" | "member";
  assistantName: string;
  assistantPersona: string;
  projectNames: string[];
  activeProject?: { key: string; name: string } | null;
};

export interface ModelProvider {
  readonly name: string;
  streamChat(input: {
    messages: ProviderMessage[];
    signal?: AbortSignal;
    /** Structured memory block injected into runtime instructions. */
    memoryBlock?: string;
    /** Live remaining project tasks injected into SESSION RUNTIME. */
    tasksBlock?: string;
    /** Live starred messages injected into SESSION RUNTIME. */
    starsBlock?: string;
    actor?: ChatActor;
  }): AsyncIterable<StreamEvent>;
}

/** Extension point: swap providers without rewriting the chat UI. */
export async function getModelProvider(): Promise<ModelProvider> {
  const { OpenAIProvider } = await import("@/lib/ai/openai");
  return new OpenAIProvider();
}
