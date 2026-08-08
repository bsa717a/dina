import type { NormalizedEvent } from "@/lib/chief-of-staff/types";

/**
 * A connector translates one external system into normalized events.
 * Connectors may call vendor APIs. The Chief of Staff Engine must not.
 */
export type Connector = {
  id: string;
  /** Emit normalized events observed since the last scan (connector-defined window). */
  collect(): Promise<NormalizedEvent[]>;
};
