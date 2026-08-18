"use client";

import { useEffect, useId, useRef, useState } from "react";

export type UserProject = {
  key: string;
  name: string;
};

export function ProjectsPill({
  projects,
  selected,
  disabled,
  onSelectProject,
}: {
  projects: UserProject[];
  selected?: UserProject | null;
  disabled?: boolean;
  onSelectProject?: (project: UserProject | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = Boolean(selected);

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
    <div ref={rootRef} className="relative mb-2">
      {open && (
        <div
          id={panelId}
          role="menu"
          aria-label="Your projects"
          className="absolute bottom-full left-0 z-20 mb-2 min-w-56 max-w-[min(100%,20rem)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
        >
          {projects.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--muted)]">
              No projects assigned yet.
            </p>
          ) : (
            <ul>
              {selected && (
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={disabled}
                    onClick={() => {
                      setOpen(false);
                      onSelectProject?.(null);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    All projects
                  </button>
                </li>
              )}
              {projects.map((project) => {
                const isSelected = selected?.key === project.key;
                return (
                  <li key={project.key}>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={disabled}
                      onClick={() => {
                        setOpen(false);
                        onSelectProject?.(project);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm disabled:opacity-40 ${
                        isSelected
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "text-[var(--foreground)] hover:bg-[var(--accent-soft)]"
                      }`}
                    >
                      <span>{project.name}</span>
                      {isSelected && (
                        <span aria-hidden="true" className="text-xs">
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={selected ? `Project: ${selected.name}` : "Projects"}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-40 ${
          open || active
            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
        }`}
      >
        {selected?.name ?? "Projects"}
      </button>
    </div>
  );
}
