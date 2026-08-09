/** Parse Attention sourceId prefixes into provider + bare resource id. */

export type AttentionMailProvider = "microsoft365" | "google" | "unknown";

export function attentionProviderFromSourceId(sourceId: string): AttentionMailProvider {
  if (sourceId.startsWith("google:")) return "google";
  if (sourceId.startsWith("microsoft365:")) return "microsoft365";
  return "unknown";
}

export function providerIdFromSourceId(sourceId: string): string {
  const prefixes = [
    "microsoft365:email:",
    "microsoft365:calendar:",
    "microsoft365:todo:",
    "google:email:",
    "google:calendar:",
  ];
  for (const prefix of prefixes) {
    if (sourceId.startsWith(prefix)) return sourceId.slice(prefix.length);
  }
  return sourceId;
}

export function accountBadgeFromRaw(
  rawJson: string | null | undefined,
  sourceId: string,
): { connector: string | null; accountLabel: string | null; accountEmail: string | null } {
  let connector: string | null = null;
  let accountLabel: string | null = null;
  let accountEmail: string | null = null;
  try {
    const raw = rawJson
      ? (JSON.parse(rawJson) as {
          connector?: string;
          accountLabel?: string;
          accountEmail?: string;
        })
      : null;
    connector = raw?.connector ?? null;
    accountLabel = raw?.accountLabel ?? null;
    accountEmail = raw?.accountEmail ?? null;
  } catch {
    // ignore
  }

  if (!connector) {
    const provider = attentionProviderFromSourceId(sourceId);
    if (provider !== "unknown") connector = provider;
  }
  if (!accountLabel) {
    if (connector === "google") accountLabel = "personal";
    if (connector === "microsoft365") accountLabel = "work";
  }
  return { connector, accountLabel, accountEmail };
}
