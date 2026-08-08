export const MEMORY_CATEGORIES = [
  "derek_profile",
  "values",
  "communication_style",
  "preferences",
  "family",
  "church",
  "health",
  "people",
  "projects",
  "commitments",
  "decisions",
  "learned_preferences",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_IMPORTANCE = ["critical", "high", "normal", "low"] as const;
export type MemoryImportance = (typeof MEMORY_IMPORTANCE)[number];

export const MEMORY_STATUSES = [
  "active",
  "pending_approval",
  "archived",
  "merged",
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** Where a memory came from — not a chat transcript id. */
export type MemorySource =
  | "chief_of_staff"
  | "chat"
  | "manual"
  | "correction"
  | "github"
  | "microsoft365"
  | string;

export type MemoryInput = {
  category: MemoryCategory;
  title: string;
  content: string;
  source: MemorySource;
  confidence: number;
  importance?: MemoryImportance;
  relatedIds?: string[];
  /** If set, correct/update this memory instead of creating a duplicate. */
  correctId?: string;
};

export type MemoryRecord = {
  id: string;
  category: MemoryCategory | string;
  title: string;
  content: string;
  source: string;
  confidence: number;
  importance: MemoryImportance | string;
  status: MemoryStatus | string;
  relatedIds: string[];
  mergedIntoId?: string | null;
  /** Reserved for future vector search — do not remove. */
  embeddingStatus: string;
  embeddingModel?: string | null;
  embeddingRef?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastAccessedAt?: Date | string | null;
};

export function categoryLabel(category: string): string {
  switch (category) {
    case "derek_profile":
      return "Derek Profile";
    case "values":
      return "Values";
    case "communication_style":
      return "Communication Style";
    case "preferences":
      return "Preferences";
    case "family":
      return "Family";
    case "church":
      return "Church";
    case "health":
      return "Health";
    case "people":
      return "People";
    case "projects":
      return "Projects";
    case "commitments":
      return "Commitments";
    case "decisions":
      return "Decisions";
    case "learned_preferences":
      return "Learned Preferences";
    default:
      return category;
  }
}

export function buildSearchText(title: string, content: string, category: string) {
  return `${categoryLabel(category)} ${title} ${content}`.toLowerCase();
}
