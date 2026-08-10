import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { logger } from "@/lib/logger";

export type UsageFeature =
  | "chat"
  | "morning.markets"
  | "morning.week_plan"
  | "morning.compose"
  | "church.search"
  | "attention.classify"
  | "attention.revise"
  | "writing.draft"
  | "learning.distill"
  | "chief_of_staff.decide"
  | string;

export type UsageRecord = {
  ts: string;
  feature: UsageFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  /** Rough USD estimate from local price table (not an invoice). */
  estUsd: number;
  meta?: Record<string, unknown>;
};

export type UsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estUsd: number;
  model?: string;
};

export function emptyUsageTotals(): UsageTotals {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    estUsd: 0,
  };
}

export function addUsageTotals(
  a: UsageTotals,
  b: Pick<
    UsageRecord,
    "inputTokens" | "outputTokens" | "reasoningTokens" | "estUsd"
  >,
): UsageTotals {
  return {
    calls: a.calls + 1,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    estUsd: a.estUsd + b.estUsd,
    model: a.model,
  };
}

/** Standard tier $/1M tokens. Update when OpenAI changes list prices. */
const PRICE_PER_M: Record<
  string,
  { input: number; cachedInput?: number; output: number }
> = {
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5-mini-2025-08-07": { input: 0.25, cachedInput: 0.025, output: 2.0 },
  "gpt-5.4-nano": { input: 0.2, cachedInput: 0.02, output: 1.25 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15.0 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10.0 },
  "gpt-5.1-codex-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
};

/** Optional in-flight chat turn bucket so nested tool LLM calls roll into per-reply usage. */
let chatTurnRef: { current: UsageTotals } | null = null;

export function attachChatTurnUsage(ref: { current: UsageTotals }) {
  chatTurnRef = ref;
}

export function detachChatTurnUsage(ref: { current: UsageTotals }) {
  if (chatTurnRef === ref) chatTurnRef = null;
}

function usageLogPath() {
  return path.join(process.cwd(), "data", "openai-usage.jsonl");
}

function normalizeModel(model: string) {
  return model.trim();
}

function lookupPrice(model: string) {
  const id = normalizeModel(model);
  if (PRICE_PER_M[id]) return PRICE_PER_M[id];
  // dated variants: gpt-4.1-mini-2025-04-14
  const base = id.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (PRICE_PER_M[base]) return PRICE_PER_M[base];
  // unknown — use gpt-4.1-mini as conservative-ish middle
  return { input: 0.4, output: 1.6 };
}

export function estimateUsd(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}): number {
  const price = lookupPrice(input.model);
  const cached = Math.min(
    Math.max(0, input.cachedTokens ?? 0),
    Math.max(0, input.inputTokens),
  );
  const uncached = Math.max(0, input.inputTokens - cached);
  const cachedRate = price.cachedInput ?? price.input * 0.1;
  // Reasoning tokens are included in output_tokens on Responses API.
  return (
    (uncached / 1_000_000) * price.input +
    (cached / 1_000_000) * cachedRate +
    (input.outputTokens / 1_000_000) * price.output
  );
}

export function extractUsageFromResponse(response: unknown): {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
} | null {
  if (!response || typeof response !== "object") return null;
  const usage = (response as { usage?: Record<string, unknown> }).usage;
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = Number(usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? 0) || 0;
  const details = (usage.output_tokens_details || {}) as Record<string, unknown>;
  const inDetails = (usage.input_tokens_details || {}) as Record<string, unknown>;
  const reasoningTokens = Number(details.reasoning_tokens ?? 0) || 0;
  const cachedTokens = Number(inDetails.cached_tokens ?? 0) || 0;

  if (!inputTokens && !outputTokens) return null;
  return { inputTokens, outputTokens, reasoningTokens, cachedTokens };
}

export function recordOpenAIUsage(input: {
  feature: UsageFeature;
  model: string;
  response?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  meta?: Record<string, unknown>;
}): UsageRecord | null {
  const extracted = input.response
    ? extractUsageFromResponse(input.response)
    : null;
  const inputTokens = input.inputTokens ?? extracted?.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? extracted?.outputTokens ?? 0;
  const reasoningTokens =
    input.reasoningTokens ?? extracted?.reasoningTokens ?? 0;
  const cachedTokens = input.cachedTokens ?? extracted?.cachedTokens ?? 0;
  if (!inputTokens && !outputTokens) return null;

  const model = normalizeModel(input.model);
  const record: UsageRecord = {
    ts: new Date().toISOString(),
    feature: input.feature,
    model,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    estUsd: estimateUsd({
      model,
      inputTokens,
      outputTokens,
      cachedTokens,
    }),
    meta: input.meta,
  };

  try {
    const file = usageLogPath();
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    logger.warn("openai_usage_write_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Do not count in-memory / per-reply totals if the ledger write failed.
    return null;
  }

  if (chatTurnRef) {
    chatTurnRef.current = {
      ...addUsageTotals(chatTurnRef.current, record),
      model: chatTurnRef.current.model || record.model,
    };
  }

  logger.info("openai_usage", {
    feature: record.feature,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens,
    cachedTokens: record.cachedTokens,
    estUsd: Number(record.estUsd.toFixed(6)),
    ...(record.meta || {}),
  });

  return record;
}

export function readUsageRecords(options?: {
  sinceMs?: number;
  featurePrefix?: string;
}): UsageRecord[] {
  const file = usageLogPath();
  if (!existsSync(file)) return [];
  const since = options?.sinceMs ?? 0;
  const prefix = options?.featurePrefix?.trim();
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out: UsageRecord[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as UsageRecord;
      if (since && new Date(row.ts).getTime() < since) continue;
      if (prefix && !String(row.feature).startsWith(prefix)) continue;
      out.push(row);
    } catch {
      // skip bad lines
    }
  }
  return out;
}

export type UsageSummary = {
  feature: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estUsd: number;
};

export function summarizeUsage(records: UsageRecord[]): UsageSummary[] {
  const map = new Map<string, UsageSummary>();
  for (const row of records) {
    const key = row.feature;
    const cur = map.get(key) || {
      feature: key,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      estUsd: 0,
    };
    cur.calls += 1;
    cur.inputTokens += row.inputTokens;
    cur.outputTokens += row.outputTokens;
    cur.reasoningTokens += row.reasoningTokens;
    cur.estUsd += row.estUsd;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.estUsd - a.estUsd);
}

/** Start of "today" in America/Denver as epoch ms. */
export function denverDayStartMs(now = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  let t = now.getTime();
  for (let i = 0; i < 48; i += 1) {
    const prevHour = t - 3_600_000;
    if (fmt.format(new Date(prevHour)) !== today) {
      for (let m = 0; m < 60; m += 1) {
        const candidate = prevHour + m * 60_000;
        if (fmt.format(new Date(candidate)) === today) return candidate;
      }
      return prevHour + 3_600_000;
    }
    t = prevHour;
  }
  return now.getTime();
}

export function getTodayUsageTotals(): UsageTotals {
  const since = denverDayStartMs();
  const rows = readUsageRecords({ sinceMs: since });
  return rows.reduce<UsageTotals>(
    (acc, row) => addUsageTotals(acc, row),
    emptyUsageTotals(),
  );
}

/** Compact label for UI: `12.4k in · 1.2k out · ~$0.03` */
export function formatUsageCompact(totals: UsageTotals): string {
  const fmt = (n: number) => {
    if (n >= 100_000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };
  const parts = [
    `${fmt(totals.inputTokens)} in`,
    `${fmt(totals.outputTokens)} out`,
  ];
  if (totals.reasoningTokens > 0) {
    parts.push(`${fmt(totals.reasoningTokens)} reason`);
  }
  parts.push(`~$${totals.estUsd < 0.01 ? totals.estUsd.toFixed(3) : totals.estUsd.toFixed(2)}`);
  return parts.join(" · ");
}
