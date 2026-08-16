#!/usr/bin/env node
/**
 * Trigger the Chief of Staff Engine scan against a running Dina server.
 * Connectors collect normalized events; the engine decides dispositions.
 * Intended for launchd: every 30 min 6:00–17:00 local. No overnight scans.
 *
 * Env:
 *   APP_URL (default http://127.0.0.1:8080)
 *   ATTENTION_SCAN_SECRET (required)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const base = (process.env.APP_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const secret = process.env.ATTENTION_SCAN_SECRET?.trim();

if (!secret) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "ATTENTION_SCAN_SECRET is not set",
    }),
  );
  process.exit(1);
}

const res = await fetch(`${base}/api/attention/scan`, {
  method: "POST",
  headers: {
    "x-attention-secret": secret,
    Accept: "application/json",
  },
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = { raw: text };
}

console.log(
  JSON.stringify({
    ok: res.ok,
    status: res.status,
    ...body,
  }),
);

if (!res.ok) process.exit(1);
