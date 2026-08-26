"use client";

import { useState } from "react";
import {
  formatRemainingTaskLines,
  formatRemainingTasksSnapshot,
} from "@/lib/project-tasks/format";

export type RemainingStripTask = {
  number: number;
  title: string;
};

export function ProjectRemainingStrip({
  projectName,
  tasks,
  loading,
  error,
}: {
  projectName: string;
  tasks: RemainingStripTask[] | null;
  loading?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const hasList = tasks !== null;
  const snapshot = hasList
    ? formatRemainingTasksSnapshot({ projectName, tasks })
    : "Checking remaining…";
  const lines = hasList ? formatRemainingTaskLines(tasks) : [];
  const canExpand = (tasks?.length ?? 0) > 0;
  const showError = Boolean(error) && !hasList && !loading;
  const label = showError
    ? error
    : loading && !hasList
      ? "Checking remaining…"
      : snapshot;

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        onClick={() => {
          if (!canExpand) return;
          setOpen((value) => !value);
        }}
        className={`w-full rounded-xl px-2.5 py-1.5 text-left text-xs leading-4 ${
          canExpand
            ? "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--foreground)]"
            : showError
              ? "text-[var(--danger)]"
              : "text-[var(--muted)]"
        }`}
      >
        {label}
      </button>
      {open && canExpand && (
        <ul className="mt-0.5 space-y-0.5 px-2.5 pb-1 text-xs leading-4 text-[var(--foreground)]">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}