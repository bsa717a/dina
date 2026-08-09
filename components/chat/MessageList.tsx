"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/components/chat/types";
import { LinkifiedText } from "@/lib/client/linkify";
import { StreamingMarkdownText } from "@/lib/client/markdown";

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function actionButtonClass(isUser: boolean, active = false) {
  return `rounded px-1 py-0.5 text-[11px] leading-none transition ${
    isUser ? "hover:bg-white/15" : "hover:bg-black/5 dark:hover:bg-white/10"
  } ${active ? (isUser ? "text-amber-200" : "text-amber-600 dark:text-amber-400") : "opacity-70"}`;
}

export function MessageList({
  messages,
  thinking,
  thinkingLabel = "Dina is thinking…",
  onToggleStar,
  starBusyId,
}: {
  messages: ChatMessage[];
  thinking: boolean;
  thinkingLabel?: string;
  onToggleStar?: (message: ChatMessage) => void;
  starBusyId?: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);

  async function copyMessage(message: ChatMessage) {
    const text = message.content?.trim();
    if (!text || text === "(attachment)") return;
    try {
      await navigator.clipboard.writeText(text);
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
      setCopiedId(message.id);
      copiedTimer.current = window.setTimeout(() => {
        setCopiedId((id) => (id === message.id ? null : id));
        copiedTimer.current = null;
      }, 1500);
    } catch {
      // Clipboard may be blocked; leave UI unchanged.
    }
  }

  useEffect(() => {
    return () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  if (!messages.length && !thinking) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div>
          <p className="text-lg font-medium tracking-tight">Dina</p>
          <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
            Ask anything, share a photo, or drop a document. I&apos;ll keep things clear and
            useful.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 pb-4 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:max-w-[75%] ${
                  isUser
                    ? "bg-[var(--user-bubble)] text-[var(--user-text)]"
                    : "bg-[var(--assistant-bubble)] text-[var(--assistant-text)]"
                }`}
              >
                {!isUser && (
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                    Dina
                  </div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mb-2 flex flex-col gap-2">
                    {message.attachments.map((attachment) => {
                      const isImage = attachment.mimeType.startsWith("image/");
                      if (isImage) {
                        return (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={attachment.id}
                            src={`/api/attachments/${attachment.id}`}
                            alt={attachment.filename}
                            className="max-h-56 w-auto rounded-xl object-cover"
                          />
                        );
                      }
                      return (
                        <div
                          key={attachment.id}
                          className="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs opacity-90 dark:border-white/10"
                        >
                          {attachment.filename}
                        </div>
                      );
                    })}
                  </div>
                )}
                {message.content && message.content !== "(attachment)" && (
                  isUser ? (
                    <div className="whitespace-pre-wrap break-words">
                      <LinkifiedText text={message.content} isUser />
                    </div>
                  ) : (
                    <StreamingMarkdownText
                      text={message.content}
                      streaming={Boolean(message.pending)}
                    />
                  )
                )}
                <div
                  className={`mt-1.5 flex items-center gap-2 text-[10px] ${
                    isUser ? "text-white/55" : "text-[var(--muted)]"
                  }`}
                >
                  <span>{formatTime(message.createdAt)}</span>
                  {!message.pending &&
                    message.content &&
                    message.content !== "(attachment)" && (
                      <button
                        type="button"
                        onClick={() => void copyMessage(message)}
                        title="Copy message"
                        aria-label="Copy message"
                        className={actionButtonClass(
                          isUser,
                          copiedId === message.id,
                        )}
                      >
                        {copiedId === message.id ? "Copied" : "Copy"}
                      </button>
                    )}
                  {!message.pending && onToggleStar && (
                    <button
                      type="button"
                      onClick={() => onToggleStar(message)}
                      disabled={starBusyId === message.id}
                      title={
                        message.starred
                          ? "Unstar this message"
                          : "Star this message for later"
                      }
                      aria-label={message.starred ? "Unstar message" : "Star message"}
                      className={actionButtonClass(isUser, Boolean(message.starred))}
                    >
                      {starBusyId === message.id ? "…" : message.starred ? "★" : "☆"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-[var(--assistant-bubble)] px-3.5 py-2.5 text-sm text-[var(--muted)]">
              <span className="dina-thinking">{thinkingLabel}</span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
