import { decideOnEvents } from "@/lib/chief-of-staff/decide";
import { persistCosDecisions } from "@/lib/chief-of-staff/apply";
import { collectNormalizedEvents } from "@/lib/connectors";
import {
  expireStaleAttentionRuns,
  findActiveAttentionRun,
  finishAttentionRun,
  listItemsNeedingNotification,
  listOpenAttentionItems,
  startAttentionRun,
  updateAttentionItemStatus,
} from "@/lib/attention/store";
import { getVapidConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendPushToAll } from "@/lib/push/web-push";

/**
 * Chief of Staff Engine scan:
 * 1) Connectors emit normalized events (vendor APIs stay in connectors)
 * 2) Cheap triage already happened in connectors (blocklist / marketing)
 * 3) Decide — disposition, priority, interrupt-or-not. No reply drafts.
 * 4) Apply decisions (attention cards, context records, etc.)
 * 5) Push only for interrupt-worthy cards
 *
 * Reply drafts are generated later when Derek opens Review draft.
 * GitHub is omitted from this scan; pass includeGitHub for a future daily job.
 */
export async function runChiefOfStaffScan(options?: { sendPush?: boolean }) {
  const sendPush = options?.sendPush ?? true;

  await expireStaleAttentionRuns();
  // Avoid piling up overlapping scans (launchd + manual) that hang on OpenAI.
  const existing = await findActiveAttentionRun();
  if (existing) {
    logger.warn("chief_of_staff_scan_skipped_already_running", {
      runId: existing.id,
      startedAt: existing.startedAt,
    });
    return {
      runId: existing.id,
      engine: "chief_of_staff" as const,
      seen: 0,
      decisions: 0,
      open: 0,
      notified: 0,
      memoriesWritten: 0,
      dispositions: {},
      connectorErrors: [] as { connectorId: string; error: string }[],
      items: [],
      skipped: true as const,
    };
  }

  const run = await startAttentionRun();

  try {
    const { events, connectorErrors } = await collectNormalizedEvents();
    if (!events.length && connectorErrors.length) {
      throw new Error(
        `No events collected. Connector errors: ${connectorErrors
          .map((e) => `${e.connectorId}: ${e.error}`)
          .join("; ")}`,
      );
    }

    const decisions = await decideOnEvents(events);
    const applied = await persistCosDecisions(run.id, events, decisions);

    let notified = 0;
    if (sendPush && getVapidConfig()) {
      const pending = await listItemsNeedingNotification();
      for (const item of pending) {
        const title =
          item.notificationTitle ||
          (item.isBlocking ? "Urgent" : item.sender || "Dina");
        const body = item.notificationBody || item.summary;

        try {
          const result = await sendPushToAll({
            title,
            body: body.slice(0, 180),
            url: `/?attention=${encodeURIComponent(item.id)}`,
            target: { type: "attention", id: item.id },
          });
          // Only mark notified when at least one device accepted the push.
          if (result.sent > 0) {
            await updateAttentionItemStatus(item.id, item.status, {
              notifiedAt: new Date(),
            });
            notified += 1;
          } else {
            logger.warn("chief_of_staff_push_no_delivery", {
              itemId: item.id,
              removed: result.removed,
              total: result.total,
            });
          }
        } catch (error) {
          logger.warn("chief_of_staff_push_failed", {
            itemId: item.id,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      }
    }

    const openItems = await listOpenAttentionItems();
    await finishAttentionRun(run.id, {
      status: "ok",
      itemsSeen: events.length,
      itemsOpen: openItems.length,
      notified,
      summaryJson: JSON.stringify({
        engine: "chief_of_staff",
        dispositions: applied.byDisposition,
        attentionCards: applied.attentionCards,
        connectorErrors,
        open: openItems.map((i) => ({
          id: i.id,
          category: i.category,
          subject: i.subject,
        })),
      }),
    });

    logger.info("chief_of_staff_scan_complete", {
      runId: run.id,
      events: events.length,
      decisions: decisions.length,
      open: openItems.length,
      notified,
      memoriesWritten: applied.memoriesWritten,
      dispositions: applied.byDisposition,
    });

    return {
      runId: run.id,
      engine: "chief_of_staff" as const,
      seen: events.length,
      decisions: decisions.length,
      open: openItems.length,
      notified,
      memoriesWritten: applied.memoriesWritten,
      dispositions: applied.byDisposition,
      connectorErrors,
      items: openItems,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await finishAttentionRun(run.id, {
      status: "error",
      itemsSeen: 0,
      itemsOpen: 0,
      notified: 0,
      error: message,
    });
    logger.error("chief_of_staff_scan_failed", {
      runId: run.id,
      error: message,
    });
    throw error;
  }
}

/** @deprecated Use runChiefOfStaffScan — kept for existing callers. */
export async function runAttentionScan(options?: { sendPush?: boolean }) {
  return runChiefOfStaffScan(options);
}
