import webpush from "web-push";
import { getVapidConfig } from "@/lib/env";
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptions,
} from "@/lib/db/push";
import { logger } from "@/lib/logger";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  target?: {
    type?: "conversation" | "message" | "approval";
    id?: string;
  };
};

function configureVapid() {
  const config = getVapidConfig();
  if (!config) return null;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return config;
}

export async function sendPushToAll(payload: PushPayload) {
  const config = configureVapid();
  if (!config) {
    throw new Error("VAPID keys are not configured.");
  }

  const subscriptions = await listPushSubscriptions();
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    target: payload.target || null,
  });

  let sent = 0;
  let removed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
      sent += 1;
    } catch (error) {
      const statusCode =
        typeof error === "object" && error && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;
      if (statusCode === 404 || statusCode === 410) {
        await deletePushSubscriptionByEndpoint(sub.endpoint);
        removed += 1;
      } else {
        logger.warn("push_send_failed", {
          endpoint: sub.endpoint.slice(0, 48),
          statusCode,
        });
      }
    }
  }

  return { sent, removed, total: subscriptions.length };
}
