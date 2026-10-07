type NotesWrite = { latest: number; applied: number };

/** Tracks in-flight note saves so an older response cannot replace newer text. */
export function createNotesWriteGuard() {
  const writes = new Map<string, NotesWrite>();

  function row(id: string): NotesWrite {
    const existing = writes.get(id);
    if (existing) return existing;
    const created = { latest: 0, applied: 0 };
    writes.set(id, created);
    return created;
  }

  return {
    start(id: string) {
      const current = row(id);
      current.latest += 1;
      return current.latest;
    },
    isCurrent(id: string, revision: number) {
      return writes.get(id)?.latest === revision;
    },
    /** Mark a note response applied. False when a newer save already started. */
    finish(id: string, revision: number) {
      const current = writes.get(id);
      if (!current || current.latest !== revision) return false;
      current.applied = revision;
      return true;
    },
    pending(id: string) {
      const current = writes.get(id);
      return Boolean(current && current.applied !== current.latest);
    },
  };
}

/**
 * Use the server notes only for the latest note save, or for another field
 * when no note save is still in flight. Otherwise keep the notes already on screen.
 */
export function shouldApplyServerNotes(
  guard: ReturnType<typeof createNotesWriteGuard>,
  taskId: string,
  notesRevision: number | undefined,
): boolean {
  if (notesRevision !== undefined) return guard.finish(taskId, notesRevision);
  return !guard.pending(taskId);
}
