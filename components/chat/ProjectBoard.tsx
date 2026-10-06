"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserProject } from "@/components/chat/ProjectsPill";

type BoardSection = {
  id: string;
  name: string;
  sortOrder: number;
};

type BoardTask = {
  number: number;
  id: string;
  title: string;
  status: string;
  sectionId: string | null;
  sectionName: string | null;
};

export function ProjectBoard({
  project,
  disabled,
  onChanged,
}: {
  project: UserProject;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<BoardSection[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState("");
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/project-sections?project=${encodeURIComponent(project.key)}`,
        );
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          sections?: BoardSection[];
          tasks?: BoardTask[];
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load sections.");
        setSections(Array.isArray(data.sections) ? data.sections : []);
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load sections.");
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [project.key, router, version]);

  async function send(input: {
    method: "POST" | "PATCH";
    body: Record<string, unknown>;
  }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project-sections", {
        method: input.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: project.key, ...input.body }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return false;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not update the project.");
      setVersion((value) => value + 1);
      onChanged?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the project.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function addSection(event: FormEvent) {
    event.preventDefault();
    const name = sectionName.trim();
    if (!name || busy || disabled) return;
    void send({ method: "POST", body: { name } }).then((ok) => {
      if (ok) setSectionName("");
    });
  }

  function addTask(event: FormEvent, sectionId: string | null) {
    event.preventDefault();
    const key = sectionId ?? "";
    const title = (taskDrafts[key] || "").trim();
    if (!title || busy || disabled) return;
    void send({
      method: "POST",
      body: { title, ...(sectionId ? { sectionId } : {}) },
    }).then((ok) => {
      if (ok) setTaskDrafts((prev) => ({ ...prev, [key]: "" }));
    });
  }

  function moveTask(task: BoardTask, sectionId: string) {
    const next = sectionId || null;
    if ((task.sectionId ?? null) === next || busy || disabled) return;
    void send({
      method: "PATCH",
      body: { number: task.number, sectionId: next },
    });
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  const ungrouped = tasks.filter(
    (task) => !task.sectionId || !sectionIds.has(task.sectionId),
  );
  const locked = Boolean(disabled || busy);

  return (
    <div
      data-testid="project-board"
      className="mb-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <form
        onSubmit={addSection}
        className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2"
      >
        <label className="sr-only" htmlFor="project-section-name">
          New section name
        </label>
        <input
          id="project-section-name"
          data-testid="add-section-name"
          value={sectionName}
          onChange={(event) => setSectionName(event.target.value)}
          placeholder="New section"
          autoComplete="off"
          disabled={locked}
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-40"
        />
        <button
          type="submit"
          data-testid="add-section"
          disabled={locked || !sectionName.trim()}
          className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
        >
          Add section
        </button>
      </form>

      <div className="max-h-64 overflow-y-auto py-1">
        {!ready ? (
          <p className="px-3 py-2 text-sm text-[var(--muted)]">Loading sections…</p>
        ) : (
          <>
            {sections.length === 0 && (
              <p className="px-3 py-2 text-sm text-[var(--muted)]">
                No sections yet. Add one, like sales, to group {project.name} tasks.
              </p>
            )}
            {sections.map((section) => (
              <section key={section.id} data-testid={`section-${section.name}`}>
                <h3 className="px-3 pt-2 text-sm font-medium">{section.name}</h3>
                <TaskList
                  tasks={tasks.filter((task) => task.sectionId === section.id)}
                  sections={sections}
                  locked={locked}
                  onMove={moveTask}
                />
                <TaskDraft
                  label={`Add a task to ${section.name}`}
                  value={taskDrafts[section.id] || ""}
                  locked={locked}
                  onChange={(value) =>
                    setTaskDrafts((prev) => ({ ...prev, [section.id]: value }))
                  }
                  onSubmit={(event) => addTask(event, section.id)}
                />
              </section>
            ))}
            {(ungrouped.length > 0 || sections.length > 0) && (
              <section data-testid="section-ungrouped">
                <h3 className="px-3 pt-2 text-sm font-medium text-[var(--muted)]">
                  Ungrouped
                </h3>
                <TaskList
                  tasks={ungrouped}
                  sections={sections}
                  locked={locked}
                  onMove={moveTask}
                />
                <TaskDraft
                  label={`Add an ungrouped task to ${project.name}`}
                  value={taskDrafts[""] || ""}
                  locked={locked}
                  onChange={(value) =>
                    setTaskDrafts((prev) => ({ ...prev, "": value }))
                  }
                  onSubmit={(event) => addTask(event, null)}
                />
              </section>
            )}
            {sections.length === 0 && ungrouped.length === 0 && ready && (
              <TaskDraft
                label={`Add a task to ${project.name}`}
                value={taskDrafts[""] || ""}
                locked={locked}
                onChange={(value) =>
                  setTaskDrafts((prev) => ({ ...prev, "": value }))
                }
                onSubmit={(event) => addTask(event, null)}
              />
            )}
          </>
        )}
      </div>
      {error && (
        <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

function TaskList({
  tasks,
  sections,
  locked,
  onMove,
}: {
  tasks: BoardTask[];
  sections: BoardSection[];
  locked: boolean;
  onMove: (task: BoardTask, sectionId: string) => void;
}) {
  if (!tasks.length) {
    return <p className="px-3 py-1 text-xs text-[var(--muted)]">(none yet)</p>;
  }
  return (
    <ul>
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-center justify-between gap-2 px-3 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-sm">
            {task.number}. {task.title}
          </span>
          {sections.length > 0 && (
            <select
              aria-label={`Section for ${task.title}`}
              data-testid={`task-section-${task.number}`}
              value={task.sectionId && sections.some((s) => s.id === task.sectionId) ? task.sectionId : ""}
              disabled={locked}
              onChange={(event) => onMove(task, event.target.value)}
              className="max-w-[9rem] shrink-0 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none disabled:opacity-40"
            >
              <option value="">Ungrouped</option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          )}
        </li>
      ))}
    </ul>
  );
}

function TaskDraft({
  label,
  value,
  locked,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2 px-3 py-1.5">
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Add a task"
        autoComplete="off"
        disabled={locked}
        className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-40"
      />
      <button
        type="submit"
        disabled={locked || !value.trim()}
        className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
      >
        Add
      </button>
    </form>
  );
}
