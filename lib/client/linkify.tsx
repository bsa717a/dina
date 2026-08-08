import type { ReactNode } from "react";

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL_RE = /https?:\/\/[^\s<>"']+/g;

function trimTrailingPunctuation(url: string) {
  let end = url.length;
  while (end > 0 && /[.,;:!?)]/.test(url[end - 1] || "")) {
    // Keep balanced closing paren that is part of some SharePoint links.
    if (url[end - 1] === ")" && (url.slice(0, end).match(/\(/g) || []).length >
      (url.slice(0, end).match(/\)/g) || []).length) {
      break;
    }
    end -= 1;
  }
  return {
    href: url.slice(0, end),
    trailing: url.slice(end),
  };
}

function linkClassName(isUser: boolean) {
  return isUser
    ? "underline underline-offset-2 break-all text-white"
    : "underline underline-offset-2 break-all text-[var(--accent)]";
}

function renderBareUrls(text: string, isUser: boolean, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(BARE_URL_RE.source, "g");
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    if (start > last) nodes.push(text.slice(last, start));
    const { href, trailing } = trimTrailingPunctuation(raw);
    nodes.push(
      <a
        key={`${keyPrefix}-${start}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName(isUser)}
      >
        {href}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    last = start + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Render message text with markdown links and bare https URLs as clickable anchors. */
export function LinkifiedText({
  text,
  isUser = false,
}: {
  text: string;
  isUser?: boolean;
}) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(MARKDOWN_LINK_RE.source, "g");

  while ((match = re.exec(text)) !== null) {
    const [full, label, href] = match;
    const start = match.index;
    if (start > last) {
      nodes.push(...renderBareUrls(text.slice(last, start), isUser, `b-${start}`));
    }
    nodes.push(
      <a
        key={`md-${start}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName(isUser)}
      >
        {label}
      </a>,
    );
    last = start + full.length;
  }

  if (last < text.length) {
    nodes.push(...renderBareUrls(text.slice(last), isUser, `t-${last}`));
  }

  return <>{nodes}</>;
}
