/** Canonical project keys aligned with derek-projects.md */
export const PROJECT_KEYS = [
  "dina",
  "beacon",
  "4studentlives",
  "metabolicos",
  "hidden_guardians",
  "clifsmama",
] as const;

export type ProjectKey = (typeof PROJECT_KEYS)[number];

const ALIASES: Record<string, ProjectKey> = {
  dina: "dina",
  "dina project": "dina",
  beacon: "beacon",
  "4studentlives": "4studentlives",
  "4 student lives": "4studentlives",
  "four student lives": "4studentlives",
  "4sl": "4studentlives",
  metabolicos: "metabolicos",
  metabolic: "metabolicos",
  "metabolic os": "metabolicos",
  hidden_guardians: "hidden_guardians",
  "hidden guardians": "hidden_guardians",
  clifsmama: "clifsmama",
  "clifs mama": "clifsmama",
  cliffsmana: "clifsmama",
};

const DISPLAY: Record<ProjectKey, string> = {
  dina: "Dina",
  beacon: "Beacon",
  "4studentlives": "4StudentLives",
  metabolicos: "MetabolicOS",
  hidden_guardians: "Hidden Guardians",
  clifsmama: "ClifsMama",
};

export function displayProjectName(key: ProjectKey): string {
  return DISPLAY[key];
}

/**
 * Resolve fuzzy project names ("Dina project", "four student lives") to a canonical key.
 */
export function resolveProjectKey(input: string): ProjectKey | null {
  const raw = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;

  const stripped = raw
    .replace(/\bprojects?\b/g, "")
    .replace(/\btasks?\b/g, "")
    .replace(/\bcommitments?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (ALIASES[raw]) return ALIASES[raw];
  if (ALIASES[stripped]) return ALIASES[stripped];

  for (const key of PROJECT_KEYS) {
    if (raw === key || stripped === key) return key;
    if (raw.includes(key.replace(/_/g, " ")) || stripped.includes(key.replace(/_/g, " "))) {
      return key;
    }
  }

  // Compact forms without spaces/underscores
  const compact = stripped.replace(/[\s_-]+/g, "");
  for (const key of PROJECT_KEYS) {
    if (compact === key.replace(/_/g, "")) return key;
  }

  return null;
}

export function assertProjectKey(input: string): ProjectKey {
  const key = resolveProjectKey(input);
  if (!key) {
    throw new Error(
      `Unknown project: "${input}". Known: ${PROJECT_KEYS.map(displayProjectName).join(", ")}`,
    );
  }
  return key;
}
