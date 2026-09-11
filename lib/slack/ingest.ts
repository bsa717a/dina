/**
 * Shared Slack inbound ingest for HTTP Events and Socket Mode.
 */

import { logger } from "@/lib/logger";
import { claimSlackEventId, releaseSlackEventId } from "./dedupe";
import { deliverSlackReply, parseSlackInboundEvent, processSlackInbound } from "./process";
import type { SlackEventCallback, SlackInboundResult } from "./types";

export async function handleSlackInboundCallback(
  payload: SlackEventCallback,
): Promise<SlackInboundResult> {
  const event = parseSlackInboundEvent(payload);
  if (!event) {
    return { handled: false, ignored: true, reason: "unhandled_event" };
  }

  const eventKey = payload.event_id || `${event.channelId}:${event.ts}`;
  if (!claimSlackEventId(eventKey)) {
    logger.info("slack_inbound_duplicate", {
      eventId: payload.event_id,
      eventTs: event.ts,
    });
    return { handled: false, ignored: true, reason: "duplicate_event" };
  }

  try {
    const result = await processSlackInbound(event);
    await deliverSlackReply(result);
    return result;
  } catch (error) {
    releaseSlackEventId(eventKey);
    throw error;
  }
}
