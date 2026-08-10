import type { ChatUsage } from "@/components/chat/types";

function fmtTokens(n: number) {
  if (n >= 100_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function formatChatUsage(usage: ChatUsage): string {
  const parts = [
    `${fmtTokens(usage.inputTokens)} in`,
    `${fmtTokens(usage.outputTokens)} out`,
  ];
  if (usage.reasoningTokens > 0) {
    parts.push(`${fmtTokens(usage.reasoningTokens)} reason`);
  }
  parts.push(
    `~$${usage.estUsd < 0.01 ? usage.estUsd.toFixed(3) : usage.estUsd.toFixed(2)}`,
  );
  return parts.join(" · ");
}

export function formatDayUsage(usage: ChatUsage): string {
  const dollars =
    usage.estUsd < 0.01 ? usage.estUsd.toFixed(3) : usage.estUsd.toFixed(2);
  return `Today ~$${dollars}`;
}
