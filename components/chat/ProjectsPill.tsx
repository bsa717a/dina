"use client";

import { useEffect, useId, useRef, useState } from "react";

export type UserProject = {
  key: string;
  name: string;
};

export function ProjectsPill({ projects }: { projects: UserProject[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative mt-2">
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Your projects"
          className="absolute bottom-full left-0 z-20 mb-2 min-w-56 max-w-[min(100%,20rem)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
        >
          {projects.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--muted)]">
              No projects assigned yet.
            </p>
          ) : (
            <ul>
              {projects.map((project) => (
                <li
                  key={project.key}
                  className="px-3 py-2 text-sm text-[var(--foreground)]"
                >
                  {project.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
          open
            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
        }`}
      >
        Projects
      </button>
    </div>
  );
}
