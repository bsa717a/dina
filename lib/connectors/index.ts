import type { NormalizedEvent } from "@/lib/chief-of-staff/types";
import { githubConnector } from "@/lib/connectors/github";
import { googleConnector } from "@/lib/connectors/google";
import { microsoftConnector } from "@/lib/connectors/microsoft";
import type { Connector } from "@/lib/connectors/types";
import { isGoogleConfigured } from "@/lib/google/config";
import { isMicrosoftConfigured } from "@/lib/microsoft/config";
import { isGitHubConfigured } from "@/lib/github/config";
import { logger } from "@/lib/logger";

/** Registered connectors. Future services only need to add an emitter here. */
export function getConnectors(): Connector[] {
  const connectors: Connector[] = [];
  if (isMicrosoftConfigured()) connectors.push(microsoftConnector);
  if (isGoogleConfigured()) connectors.push(googleConnector);
  if (isGitHubConfigured()) connectors.push(githubConnector);
  return connectors;
}

/**
 * Collect normalized events from every connector.
 * One connector failing must not block the others.
 */
export async function collectNormalizedEvents(): Promise<{
  events: NormalizedEvent[];
  connectorErrors: Array<{ connectorId: string; error: string }>;
}> {
  const connectors = getConnectors();
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
