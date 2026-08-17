"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const REMARK_PLUGINS = [remarkGfm];

function linkClassName(isUser: boolean) {
  return isUser
    ? "underline underline-offset-2 break-all text-white"
    : "underline underline-offset-2 break-all text-[var(--accent)]";
}

function buildComponents(isUser: boolean): Components {
  return {
    h1: ({ children }) => (
      <h1 className="mb-2 mt-1 text-[1.15rem] font-semibold tracking-tight first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-1.5 mt-3 text-[1.02rem] font-semibold tracking-tight first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1 mt-2.5 text-[0.95rem] font-semibold first:mt-0">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-2 text-[0.92rem] font-semibold first:mt-0">
        {children}
      </h4>
    ),
    p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="my-1.5 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
        {children}
      </ul>
    ),
    ol: ({ children, start }) => (
      <ol
        start={typeof start === "number" && start > 1 ? start : undefined}
        className="my-1.5 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0"
      >
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName(isUser)}
      >
        {children}
      </a>
    ),
    hr: () => (
      <hr
        className={`my-3 border-0 border-t ${
          isUser ? "border-white/25" : "border-black/10 dark:border-white/15"
        }`}
      />
    ),
    blockquote: ({ children }) => (
      <blockquote
        className={`my-2 border-l-2 pl-3 opacity-90 ${
          isUser ? "border-white/40" : "border-black/15 dark:border-white/20"
        }`}
      >
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock = Boolean(className?.includes("language-"));
      if (isBlock) {
        return (
          <code className="block whitespace-pre-wrap break-words rounded-lg bg-black/5 px-2.5 py-2 text-[0.85em] dark:bg-white/10">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-black/5 px-1 py-0.5 text-[0.9em] dark:bg-white/10">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-2 overflow-x-auto rounded-lg first:mt-0 last:mb-0">
        {children}
      </pre>
    ),
  };
}

const ASSISTANT_COMPONENTS = buildComponents(false);
const USER_COMPONENTS = buildComponents(true);

/** Render assistant (or user) message markdown with GFM. HTML is not enabled. */
export function MarkdownText({
  text,
  isUser = false,
}: {
  text: string;
  isUser?: boolean;
}) {
  const components = useMemo(
    () => (isUser ? USER_COMPONENTS : ASSISTANT_COMPONENTS),
    [isUser],
  );

  return (
    <div className="markdown-message break-words">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Markdown while streaming: same renderer as the final message (no layout jump),
 * but throttle re-parses so every token delta is not a full remount.
 */
export function StreamingMarkdownText({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (!streaming) {
      setShown(text);
      return;
    }
    const id = window.setTimeout(() => setShown(text), 120);
    return () => window.clearTimeout(id);
  }, [text, streaming]);

  return <MarkdownText text={streaming ? shown : text} />;
}
