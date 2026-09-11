/**
 * Slack Socket Mode inbound for the Regi-only Piper bot.
 *
 * Preferred event path when SLACK_APP_TOKEN (xapp-…) is set.
 * Envelopes are unwrapped to the same event_callback shape as HTTP Events
 * and fed through handleSlackInboundCallback → processSlackInbound.
 */

import { logger } from "@/lib/logger";
import {
  getSlackAppToken,
  getSlackSocketModeProcess,
  isSlackSocketModeConfigured,
} from "@/lib/env";
import { handleSlackInboundCallback } from "./ingest";
import {
  setSlackSocketStatus,
  type SlackSocketSource,
} from "./socket-status";
import type { SlackEventCallback } from "./types";

export interface SlackSocketEnvelope {
  type?: string;
  envelope_id?: string;
  payload?: unknown;
}

export interface SlackSocketStartResult {
  started: boolean;
  reason: string;
}

type AckFn = (response?: Record<string, unknown>) => Promise<void>;

export interface SlackSocketEventArgs {
  ack: AckFn;
  type?: string;
  body?: unknown;
}

type SocketModeLike = {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  start: () => Promise<unknown>;
  disconnect: () => Promise<void>;
};

let client: SocketModeLike | null = null;
let starting: Promise<SlackSocketStartResult> | null = null;

export function extractSlackEventCallback(
  envelopeOrPayload: unknown,
): SlackEventCallback | null {
  if (!envelopeOrPayload || typeof envelopeOrPayload !== "object") return null;
  const obj = envelopeOrPayload as Record<string, unknown>;

  if (obj.type === "events_api" && obj.payload && typeof obj.payload === "object") {
    return extractSlackEventCallback(obj.payload);
  }

  if (obj.type === "event_callback" && obj.event && typeof obj.event === "object") {
    return obj as unknown as SlackEventCallback;
  }

  return null;
}

export async function handleSlackSocketEvent(
  args: SlackSocketEventArgs,
): Promise<SlackInboundSocketResult> {
  try {
    await args.ack();
  } catch (error) {
    logger.error("slack_socket_ack_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }

  const envelopeType = args.type;
  if (envelopeType && envelopeType !== "events_api") {
    return { handled: false, ignored: true, reason: "unhandled_envelope" };
  }

  const callback = extractSlackEventCallback(args.body);
  if (!callback) {
    return { handled: false, ignored: true, reason: "unhandled_event" };
  }

  const innerType =
    typeof callback.event?.type === "string" ? callback.event.type : undefined;
  setSlackSocketStatus({
    lastEventAt: new Date().toISOString(),
    lastEventType: innerType,
  });

  return handleSlackInboundCallback(callback);
}

export type SlackInboundSocketResult = Awaited<
  ReturnType<typeof handleSlackInboundCallback>
>;

export function shouldStartSocketModeInProcess(): boolean {
  return (
    isSlackSocketModeConfigured() && getSlackSocketModeProcess() === "in-process"
  );
}

export async function startSlackSocketMode(options: {
  source: SlackSocketSource;
}): Promise<SlackSocketStartResult> {
  if (starting) return starting;
  starting = startSlackSocketModeInner(options);
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

async function startSlackSocketModeInner(options: {
  source: SlackSocketSource;
}): Promise<SlackSocketStartResult> {
  if (!isSlackSocketModeConfigured()) {
    setSlackSocketStatus({ configured: false, started: false, connected: false });
    logger.info("slack_socket_skipped", { reason: "not_configured" });
    return { started: false, reason: "not_configured" };
  }

  const mode = getSlackSocketModeProcess();
  if (mode === "off") {
    logger.info("slack_socket_skipped", { reason: "off" });
    return { started: false, reason: "off" };
  }
  if (mode === "standalone" && options.source === "instrumentation") {
    logger.info("slack_socket_skipped", { reason: "standalone" });
    return { started: false, reason: "standalone" };
  }

  if (client) {
    return { started: true, reason: "already_started" };
  }

  const appToken = getSlackAppToken();
  if (!appToken) {
    return { started: false, reason: "not_configured" };
  }

  setSlackSocketStatus({
    configured: true,
    started: false,
    connected: false,
    source: options.source,
    lastError: undefined,
  });

  try {
    const { SocketModeClient } = await import("@slack/socket-mode");
    const socket = new SocketModeClient({ appToken });
    client = socket;

    socket.on("connected", () => {
      setSlackSocketStatus({
        started: true,
        connected: true,
        lastError: undefined,
      });
      logger.info("slack_socket_connected", { source: options.source });
    });

    socket.on("disconnected", () => {
      setSlackSocketStatus({ connected: false });
      logger.warn("slack_socket_disconnected", { source: options.source });
    });

    socket.on("error", (...args: unknown[]) => {
      const error = args[0];
      const message =
        error instanceof Error ? error.message : "socket_mode_error";
      setSlackSocketStatus({ lastError: message, connected: false });
      logger.error("slack_socket_error", { error: message });
    });

    socket.on("slack_event", (...args: unknown[]) => {
      const event = args[0] as SlackSocketEventArgs | undefined;
      if (!event || typeof event.ack !== "function") return;
      void handleSlackSocketEvent({
        ack: event.ack,
        type: event.type,
        body: event.body,
      }).catch((error) => {
        logger.error("slack_socket_event_error", {
          error: error instanceof Error ? error.message : "unknown",
        });
      });
    });

    await socket.start();
    setSlackSocketStatus({ started: true, source: options.source });
    logger.info("slack_socket_started", { source: options.source });
    return { started: true, reason: "started" };
  } catch (error) {
    client = null;
    const message = error instanceof Error ? error.message : "unknown";
    setSlackSocketStatus({
      started: false,
      connected: false,
      lastError: message,
    });
    logger.error("slack_socket_start_failed", { error: message });
    return { started: false, reason: "start_failed" };
  }
}

export async function stopSlackSocketMode(): Promise<void> {
  const current = client;
  client = null;
  if (!current) {
    setSlackSocketStatus({ started: false, connected: false, source: null });
    return;
  }
  try {
    await current.disconnect();
  } catch (error) {
    logger.warn("slack_socket_stop_failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  setSlackSocketStatus({ started: false, connected: false, source: null });
}
