/** Finished tasks stay on the Done board for two weeks, measured from completedAt. */
export const RECENTLY_COMPLETED_MS = 14 * 24 * 60 * 60 * 1000;

export function recentlyCompletedSince(now: Date = new Date()): Date {
  return new Date(now.getTime() - RECENTLY_COMPLETED_MS);
}
