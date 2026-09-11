#!/usr/bin/env node
/**
 * Dedicated Slack Socket Mode worker for the Regi-only Piper bot.
 *
 * Use when the Next.js process should not hold the WebSocket
 * (SLACK_SOCKET_MODE=standalone on the web service).
 *
 *   npm run slack:socket
 *
 * Needs the same env as Dina (DATABASE_URL, Slack tokens, Grok Bot webhook).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

async function main() {
  const { startSlackSocketMode, stopSlackSocketMode } = await import(
    "../lib/slack/socket"
  );

  const result = await startSlackSocketMode({ source: "worker" });
  if (!result.started) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        message: "slack_socket_worker_failed",
        meta: { reason: result.reason },
      }),
    );
    process.exit(1);
  }

  async function shutdown(signal: string) {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        message: "slack_socket_worker_shutdown",
        meta: { signal },
      }),
    );
    await stopSlackSocketMode();
    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main();
