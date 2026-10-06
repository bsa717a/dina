"use client";

import { FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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

type AddMode = "section" | "task" | null;

type PopoverBox = { top: number; left: number; width: number };

function placePopover(anchor: HTMLElement): PopoverBox {
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  const width = Math.min(448, window.innerWidth - margin * 2);
  const left = Math.min(
    Math.max(margin, rect.left),
    Math.max(margin, window.innerWidth - margin - width),
  );
  const height = 132;
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - 8 - height);
  }
  return { top, left, width };
}

export function ProjectAddButton({
  project,
  disabled,
  refreshKey = 0,
  onChanged,
}: {
  project: UserProject;
  disabled?: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<AddMode>(null);
  const [sections, setSections] = useState<BoardSection[]>([]);
  const [sectionName, setSectionName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskSectionId, setTaskSectionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          sections?: BoardSection[];
        };
        if (cancelled || !res.ok) return;
        setSections(Array.isArray(data.sections) ? data.sections : []);
      } catch {
        if (!cancelled) setSections([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [project.key, refreshKey, router]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: project.key, ...body }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return false;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not update the project.");
      onChanged?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the project.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function choose(next: AddMode) {
    setMenuOpen(false);
    setError(null);
    setMode(next);
    if (next === "task") setTaskSectionId("");
  }

  function addSection(event: FormEvent) {
    event.preventDefault();
    const name = sectionName.trim();
    if (!name || busy || disabled) return;
    void send({ name }).then((ok) => {
      if (!ok) return;
      setSectionName("");
      setMode(null);
    });
  }

  function addTask(event: FormEvent) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title || busy || disabled) return;
    void send({
      title,
      ...(taskSectionId ? { sectionId: taskSectionId } : {}),
    }).then((ok) => {
      if (!ok) return;
      setTaskTitle("");
      setTaskSectionId("");
      setMode(null);
    });
  }

  const locked = Boolean(disabled || busy);
  const formOpen = mode !== null;
  const [popover, setPopover] = useState<PopoverBox | null>(null);

  useLayoutEffect(() => {
    if (!formOpen) return;
    function place() {
      const anchor = rootRef.current;
      if (!anchor) return;
      setPopover(placePopover(anchor));
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [formOpen]);

  const popoverStyle = popover
    ? { top: popover.top, left: popover.left, width: popover.width }
    : undefined;
  const popoverClass =
    "fixed z-30 flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg sm:flex-row sm:items-center";

  return (
    <div ref={rootRef} className="relative">
      {menuOpen && (
        <div
          id={panelId}
          role="menu"
          aria-label={`Add to ${project.name}`}
          data-testid="project-add-menu"
          className="absolute bottom-full left-0 z-20 mb-2 min-w-40 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="choose-add-section"
            disabled={locked}
            onClick={() => choose("section")}
            className="block w-full px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
          >
            Add section
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="choose-add-task"
            disabled={locked}
            onClick={() => choose("task")}
            className="block w-full px-3 py-2 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
          >
            Add task
          </button>
        </div>
      )}
      <button
        type="button"
        data-testid="project-add"
        aria-expanded={menuOpen}
        aria-controls={panelId}
        aria-label={`Add section or task to ${project.name}`}
        disabled={locked}
        onClick={() => setMenuOpen((open) => !open)}
        className={`flex h-7 w-7 items-center justify-center rounded-full border text-base leading-none transition disabled:opacity-40 ${
          menuOpen
            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
        }`}
      >
        +
      </button>
      {mode === "section" && popoverStyle && (
        <form
          onSubmit={addSection}
          data-testid="add-section-form"
          style={popoverStyle}
          className={popoverClass}
        >
          <label className="sr-only" htmlFor="project-section-name">
            Section name
          </label>
          <input
            id="project-section-name"
            data-testid="add-section-name"
            value={sectionName}
            onChange={(event) => setSectionName(event.target.value)}
            placeholder="Section name"
            autoComplete="off"
            disabled={locked}
            className="w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-40 sm:flex-1"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              data-testid="add-section"
              disabled={locked || !sectionName.trim()}
              className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(null);
                setError(null);
              }}
              className="shrink-0 px-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
          </div>
          {error && <p className="w-full text-xs text-[var(--danger)]">{error}</p>}
        </form>
      )}
      {mode === "task" && popoverStyle && (
        <form
          onSubmit={addTask}
          data-testid="add-task-form"
          style={popoverStyle}
          className={popoverClass}
        >
          <label className="sr-only" htmlFor="project-task-title">
            Task
          </label>
          <input
            id="project-task-title"
            data-testid="add-task-title"
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            placeholder="Task"
            autoComplete="off"
            disabled={locked}
            className="w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none ring-[var(--accent)] focus:ring-2 disabled:opacity-40 sm:flex-1"
          />
          <div className="flex min-w-0 items-center gap-2">
            <select
              aria-label="Section"
              data-testid="add-task-section"
              value={taskSectionId}
              disabled={locked}
              onChange={(event) => setTaskSectionId(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm outline-none disabled:opacity-40 sm:w-28 sm:flex-none"
            >
              <option value=""></option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              data-testid="add-task"
              disabled={locked || !taskTitle.trim()}
              className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(null);
                setTaskSectionId("");
                setError(null);
              }}
              className="shrink-0 px-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Cancel
            </button>
          </div>
          {error && <p className="w-full text-xs text-[var(--danger)]">{error}</p>}
        </form>
      )}
    </div>
  );
}

export function ProjectBoard({
  project,
  disabled,
  refreshKey = 0,
  onChanged,
}: {
  project: UserProject;
  disabled?: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<BoardSection[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  }, [project.key, refreshKey, router, version]);

  async function moveTask(task: BoardTask, sectionId: string) {
    const next = sectionId || null;
    if ((task.sectionId ?? null) === next || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: project.key,
          number: task.number,
          sectionId: next,
        }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not move the task.");
      setVersion((value) => value + 1);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move the task.");
    } finally {
      setBusy(false);
    }
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  const ungrouped = tasks.filter(
    (task) => !task.sectionId || !sectionIds.has(task.sectionId),
  );
  const locked = Boolean(disabled || busy);

  if (!ready) {
    return (
      <p className="mb-2 px-1 text-sm text-[var(--muted)]">Loading sections…</p>
    );
  }
  if (!sections.length && !tasks.length && !error) return null;

  return (
    <div
      data-testid="project-board"
      className="mb-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="max-h-64 overflow-y-auto py-1">
        {sections.map((section) => (
          <section key={section.id} data-testid={`section-${section.name}`}>
            <h3 className="px-3 pt-2 text-sm font-medium">{section.name}</h3>
            <TaskList
              tasks={tasks.filter((task) => task.sectionId === section.id)}
              sections={sections}
              locked={locked}
              onMove={moveTask}
            />
          </section>
        ))}
        {ungrouped.length > 0 && (
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
          </section>
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
              value={
                task.sectionId && sections.some((section) => section.id === task.sectionId)
                  ? task.sectionId
                  : ""
              }
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
