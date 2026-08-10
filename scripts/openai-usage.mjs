#!/usr/bin/env node
/**
 * Summarize local OpenAI usage from data/openai-usage.jsonl
 *
 *   npm run usage
 *   npm run usage -- --hours 24
 *   npm run usage -- --feature morning
 *   npm run usage -- --feature chat --hours 6
 */

import { existsSync, readFileSync } from "fs";
import path from "path";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] || null;
}

const hours = Number(argValue("--hours") || "48");
const feature = argValue("--feature") || "";
const file = path.join(process.cwd(), "data", "openai-usage.jsonl");

if (!existsSync(file)) {
  console.log(`No usage log yet at ${file}`);
  console.log("Use Dina (chat / morning brief / church search) then re-run.");
  process.exit(0);
}

const since = Date.now() - hours * 3600 * 1000;
const rows = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try {
    const row = JSON.parse(line);
    if (new Date(row.ts).getTime() < since) continue;
    if (feature && !String(row.feature || "").startsWith(feature)) continue;
    rows.push(row);
  } catch {
    // skip
  }
}

if (!rows.length) {
  console.log(`No usage rows in the last ${hours}h${feature ? ` for feature=${feature}` : ""}.`);
  process.exit(0);
}

const byFeature = new Map();
const byModel = new Map();
let totalIn = 0;
let totalOut = 0;
let totalReason = 0;
let totalUsd = 0;

function bump(map, key, row) {
  const cur = map.get(key) || {
    key,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    estUsd: 0,
  };
  cur.calls += 1;
  cur.inputTokens += row.inputTokens || 0;
  cur.outputTokens += row.outputTokens || 0;
  cur.reasoningTokens += row.reasoningTokens || 0;
  cur.estUsd += row.estUsd || 0;
  map.set(key, cur);
}

for (const row of rows) {
  bump(byFeature, row.feature || "unknown", row);
  bump(byModel, row.model || "unknown", row);
  totalIn += row.inputTokens || 0;
  totalOut += row.outputTokens || 0;
  totalReason += row.reasoningTokens || 0;
  totalUsd += row.estUsd || 0;
}

function printTable(title, map) {
  console.log(`\n${title}`);
  console.log(
    "feature/model".padEnd(28) +
      "calls".padStart(7) +
      "input".padStart(10) +
      "output".padStart(10) +
      "reason".padStart(10) +
      "est$".padStart(10),
  );
  const rowsSorted = Array.from(map.values()).sort((a, b) => b.estUsd - a.estUsd);
  for (const r of rowsSorted) {
    console.log(
      String(r.key).slice(0, 28).padEnd(28) +
        String(r.calls).padStart(7) +
        String(r.inputTokens).padStart(10) +
        String(r.outputTokens).padStart(10) +
        String(r.reasoningTokens).padStart(10) +
        r.estUsd.toFixed(4).padStart(10),
    );
  }
}

console.log(`OpenAI usage (last ${hours}h)${feature ? ` · feature*=${feature}` : ""}`);
console.log(`Log: ${file}`);
console.log(`Calls: ${rows.length}`);
console.log(
  `Totals — input ${totalIn} · output ${totalOut} · reasoning ${totalReason} · est $${totalUsd.toFixed(4)}`,
);
console.log("(est$ is from local price table, not the OpenAI invoice)");

printTable("By feature", byFeature);
printTable("By model", byModel);

// Email / calendar attribution from chat meta.tools
const toolHits = new Map();
for (const row of rows) {
  const tools = row.meta?.tools;
  if (!Array.isArray(tools)) continue;
  for (const t of tools) {
    const cur = toolHits.get(t) || { tool: t, calls: 0, estUsd: 0, inputTokens: 0 };
    cur.calls += 1;
    cur.estUsd += row.estUsd || 0;
    cur.inputTokens += row.inputTokens || 0;
    toolHits.set(t, cur);
  }
}
if (toolHits.size) {
  console.log("\nChat rounds that called tools (cost attributed to whole round)");
  for (const r of Array.from(toolHits.values()).sort((a, b) => b.estUsd - a.estUsd)) {
    console.log(
      `  ${r.tool.padEnd(28)} rounds=${String(r.calls).padStart(3)}  in=${String(r.inputTokens).padStart(8)}  est$${r.estUsd.toFixed(4)}`,
    );
  }
}
