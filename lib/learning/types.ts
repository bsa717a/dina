export type LessonCategory = "learned_preferences" | "decisions";

export type LessonCandidate = {
  category: LessonCategory;
  title: string;
  content: string;
  confidence: number;
  /** derek_feedback → active; learning_engine → pending_approval for prefs */
  source: "derek_feedback" | "learning_engine";
};

export type LearningSignal = {
  action:
    | "edited_draft"
    | "revise_draft"
    | "dismissed_unimportant"
    | "accepted_recommendation"
    | "sent_draft";
  note?: string | null;
  priorRecommendedAction?: string | null;
  priorDraftBody?: string | null;
  draftSubject?: string | null;
  draftBody?: string | null;
  itemSummary?: string | null;
  itemCategory?: string | null;
  subject?: string | null;
};
