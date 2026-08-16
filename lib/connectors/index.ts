import type { NormalizedEvent } from "@/lib/chief-of-staff/types";
import { githubConnector } from "@/lib/connectors/github";
import { googleConnector } from "@/lib/connectors/google";
import { microsoftConnector } from "@/lib/connectors/microsoft";
import type { Connector } from "@/lib/connectors/types";
import { isGoogleConfigured } from "@/lib/google/config";
import { isMicrosoftConfigured } from "@/lib/microsoft/config";
import { isGitHubConfigured } from "@/lib/github/config";
import { logger } from "@/lib/logger";

export type CollectOptions = {
  /**
   * GitHub is off for the regular Attention scan (too noisy vs mail/calendar).
   * Pass true for a future once-a-day GitHub pass — chat GitHub tools stay on.
   */
  includeGitHub?: boolean;
};

/** Registered connectors. Future services only need to add an emitter here. */
export function getConnectors(options?: CollectOptions): Connector[] {
  const connectors: Connector[] = [];
  if (isMicrosoftConfigured()) connectors.push(microsoftConnector);
  if (isGoogleConfigured()) connectors.push(googleConnector);
  if (options?.includeGitHub && isGitHubConfigured()) {
    connectors.push(githubConnector);
  }
  return connectors;
}

/**
 * Collect normalized events from every connector enabled for this scan.
 * One connector failing must not block the others.
 */
export async function collectNormalizedEvents(
  options?: CollectOptions,
): Promise<{
  events: NormalizedEvent[];
  connectorErrors: Array<{ connectorId: string; error: string }>;
}> {
  const connectors = getConnectors(options);
  const settled = await Promise.allSettled(
    connectors.map(async (connector) => ({
      connectorId: connector.id,
      events: await connector.collect(),
    })),
  );

  const events: NormalizedEvent[] = [];
  const connectorErrors: Array<{ connectorId: string; error: string }> = [];

  settled.forEach((result, index) => {
    const id = connectors[index]?.id || `connector_${index}`;
    if (result.status === "fulfilled") {
      events.push(...result.value.events);
    } else {
      const error =
        result.reason instanceof Error ? result.reason.message : "unknown";
      connectorErrors.push({ connectorId: id, error });
      logger.warn("connector_collect_failed", { connectorId: id, error });
    }
  });

  return { events, connectorErrors };
}
