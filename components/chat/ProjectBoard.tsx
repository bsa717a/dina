"use client";

import {
  FormEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { UserProject } from "@/components/chat/ProjectsPill";
import {
  createNotesWriteGuard,
  shouldApplyServerNotes,
} from "@/lib/client/notes-save";
import {
  taskOwnedByViewer,
  whiteboardHeading,
  type WhiteboardScope,
  type WhiteboardViewer,
} from "@/lib/client/whiteboard";

type BoardSection = {
  id: string;
  name: string;
  sortOrder: number;
};

type BoardPerson = {
  id: string;
  name: string;
};

type BoardTask = {
  number: number;
  id: string;
  title: string;
  status: string;
  sectionId: string | null;
  sectionName: string | null;
  assigneeUserId: string | null;
  notes: string;
  dueAt: string | null;
};

type TaskDetailsPatch = {
  assigneeUserId?: string | null;
  dueAt?: string | null;
  notes?: string;
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
  ownerName,
  viewer = null,
  scope = "all",
  disabled,
  refreshKey = 0,
  onChanged,
}: {
  project: UserProject;
  ownerName?: string | null;
  viewer?: WhiteboardViewer | null;
  scope?: WhiteboardScope;
  disabled?: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [sections, setSections] = useState<BoardSection[]>([]);
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [people, setPeople] = useState<BoardPerson[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const notesWrites = useRef(createNotesWriteGuard());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
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
          tasks?: Array<
            Omit<BoardTask, "assigneeUserId" | "notes" | "dueAt"> & {
              assigneeUserId?: string | null;
              notes?: string | null;
              dueAt?: string | null;
            }
          >;
          people?: BoardPerson[];
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load sections.");
        const nextTasks = (Array.isArray(data.tasks) ? data.tasks : []).map((task) => ({
          ...task,
          assigneeUserId: task.assigneeUserId ?? null,
          notes: task.notes ?? "",
          dueAt: task.dueAt ?? null,
        }));
        setSections(Array.isArray(data.sections) ? data.sections : []);
        setPeople(Array.isArray(data.people) ? data.people : []);
        setTasks(nextTasks);
        setExpandedId((current) =>
          current && nextTasks.some((task) => task.id === current) ? current : null,
        );
        setCompletingId((current) =>
          current && nextTasks.some((task) => task.id === current) ? current : null,
        );
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

  async function saveDetails(task: BoardTask, patch: TaskDetailsPatch) {
    if (disabled) return;
    const notesRevision =
      patch.notes !== undefined ? notesWrites.current.start(task.id) : undefined;
    setError(null);
    try {
      const res = await fetch("/api/project-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: project.key,
          taskId: task.id,
          ...patch,
        }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        task?: BoardTask;
      };
      if (
        notesRevision !== undefined &&
        !notesWrites.current.isCurrent(task.id, notesRevision)
      ) {
        return;
      }
      if (!res.ok || !data.task) {
        throw new Error(data.error || "Could not update the task.");
      }
      const saved = data.task;
      const applyNotes = shouldApplyServerNotes(
        notesWrites.current,
        saved.id,
        notesRevision,
      );
      setTasks((current) =>
        current.map((item) =>
          item.id === saved.id
            ? {
                ...item,
                ...saved,
                assigneeUserId: saved.assigneeUserId ?? null,
                notes: applyNotes ? (saved.notes ?? "") : item.notes,
                dueAt: saved.dueAt ?? null,
              }
            : item,
        ),
      );
      onChanged?.();
    } catch (err) {
      if (
        notesRevision !== undefined &&
        !notesWrites.current.isCurrent(task.id, notesRevision)
      ) {
        return;
      }
      const message = err instanceof Error ? err.message : "Could not update the task.";
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }

  async function completeTask(task: BoardTask) {
    if (busy || disabled || completingId === task.id) return;
    setCompletingId(task.id);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/project-sections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: project.key,
          taskId: task.id,
          complete: true,
        }),
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not complete the task.");
      setVersion((value) => value + 1);
      onChanged?.();
    } catch (err) {
      setCompletingId(null);
      setError(err instanceof Error ? err.message : "Could not complete the task.");
    } finally {
      setBusy(false);
    }
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  const visibleTasks =
    scope === "mine" ? tasks.filter((task) => taskOwnedByViewer(task, viewer)) : tasks;
  const ungrouped = visibleTasks.filter(
    (task) => !task.sectionId || !sectionIds.has(task.sectionId),
  );
  const locked = Boolean(disabled || busy);
  const heading = whiteboardHeading(ownerName);

  return (
    <div id="project-task-list" data-testid="project-board" className="whiteboard">
      <div className="whiteboard-surface">
        <h2 className="whiteboard-title">{heading}</h2>
        {!ready ? (
          <p className="whiteboard-muted">Loading sections…</p>
        ) : (
          <div className="whiteboard-scroll">
            {sections.map((section) => (
              <section key={section.id} data-testid={`section-${section.name}`}>
                <h3 className="whiteboard-section">{section.name}</h3>
                <TaskList
                  tasks={visibleTasks.filter((task) => task.sectionId === section.id)}
                  sections={sections}
                  people={people}
                  locked={locked}
                  completingId={completingId}
                  expandedId={expandedId}
                  onToggle={setExpandedId}
                  onMove={moveTask}
                  onComplete={completeTask}
                  onSave={saveDetails}
                />
              </section>
            ))}
            {ungrouped.length > 0 && (
              <section data-testid="section-ungrouped">
                <h3 className="whiteboard-section">Ungrouped</h3>
                <TaskList
                  tasks={ungrouped}
                  sections={sections}
                  people={people}
                  locked={locked}
                  completingId={completingId}
                  expandedId={expandedId}
                  onToggle={setExpandedId}
                  onMove={moveTask}
                  onComplete={completeTask}
                  onSave={saveDetails}
                />
              </section>
            )}
            {!sections.length && !visibleTasks.length && !error && (
              <p className="whiteboard-muted">Nothing on the board yet.</p>
            )}
          </div>
        )}
        {error && <p className="whiteboard-error">{error}</p>}
      </div>
    </div>
  );
}

function stopRowToggle(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function rowToggleTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return !target.closest("input, select, textarea, button, a, label");
}

function TaskList({
  tasks,
  sections,
  people,
  locked,
  completingId,
  expandedId,
  onToggle,
  onMove,
  onComplete,
  onSave,
}: {
  tasks: BoardTask[];
  sections: BoardSection[];
  people: BoardPerson[];
  locked: boolean;
  completingId: string | null;
  expandedId: string | null;
  onToggle: (taskId: string | null) => void;
  onMove: (task: BoardTask, sectionId: string) => void;
  onComplete: (task: BoardTask) => void;
  onSave: (task: BoardTask, patch: TaskDetailsPatch) => Promise<void>;
}) {
  if (!tasks.length) {
    return <p className="whiteboard-muted">(none yet)</p>;
  }
  return (
    <ul className="whiteboard-tasks">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          sections={sections}
          people={people}
          locked={locked}
          done={completingId === task.id}
          open={expandedId === task.id}
          onToggle={() => onToggle(expandedId === task.id ? null : task.id)}
          onMove={onMove}
          onComplete={onComplete}
          onSave={onSave}
        />
      ))}
    </ul>
  );
}

function TaskRow({
  task,
  sections,
  people,
  locked,
  done,
  open,
  onToggle,
  onMove,
  onComplete,
  onSave,
}: {
  task: BoardTask;
  sections: BoardSection[];
  people: BoardPerson[];
  locked: boolean;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  onMove: (task: BoardTask, sectionId: string) => void;
  onComplete: (task: BoardTask) => void;
  onSave: (task: BoardTask, patch: TaskDetailsPatch) => Promise<void>;
}) {
  const panelId = useId();
  const knownOwner = people.some((person) => person.id === task.assigneeUserId);

  return (
    <li className="whiteboard-task-item" data-testid={`task-row-${task.number}`}>
      <div
        className="whiteboard-task-line"
        onClick={(event) => {
          if (!rowToggleTarget(event.target)) return;
          onToggle();
        }}
      >
        <span
          className={`whiteboard-check${done ? " is-checked" : ""}`}
          onClick={stopRowToggle}
          onPointerDown={stopRowToggle}
        >
          <input
            type="checkbox"
            checked={done}
            disabled={locked}
            aria-label={`Mark done: ${task.title}`}
            data-testid={`task-done-${task.number}`}
            onClick={stopRowToggle}
            onChange={() => onComplete(task)}
          />
        </span>
        <span
          className={`whiteboard-task${done ? " is-done" : ""}`}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-controls={panelId}
          data-testid={`task-expand-${task.number}`}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onToggle();
          }}
        >
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
            onClick={stopRowToggle}
            onPointerDown={stopRowToggle}
            onChange={(event) => onMove(task, event.target.value)}
            className="whiteboard-select"
          >
            <option value="">Ungrouped</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {open ? (
        <TaskEditor
          id={panelId}
          task={task}
          people={people}
          knownOwner={knownOwner}
          locked={locked}
          onSave={onSave}
        />
      ) : null}
    </li>
  );
}

function TaskEditor({
  id,
  task,
  people,
  knownOwner,
  locked,
  onSave,
}: {
  id: string;
  task: BoardTask;
  people: BoardPerson[];
  knownOwner: boolean;
  locked: boolean;
  onSave: (task: BoardTask, patch: TaskDetailsPatch) => Promise<void>;
}) {
  const [draft, setDraft] = useState(task.notes);
  const savedNotes = useRef(task.notes);
  const draftRef = useRef(task.notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  const taskRef = useRef(task);

  useEffect(() => {
    onSaveRef.current = onSave;
    taskRef.current = task;
  });

  useEffect(() => {
    const draftNotes = draftRef.current.trim();
    if (draftNotes !== savedNotes.current) return;
    if (task.notes === savedNotes.current) return;
    savedNotes.current = task.notes;
    draftRef.current = task.notes;
    setDraft(task.notes);
  }, [task.notes]);

  async function commitNotes(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const trimmed = value.trim();
    if (trimmed === savedNotes.current) return;
    const previous = savedNotes.current;
    savedNotes.current = trimmed;
    try {
      await onSaveRef.current(taskRef.current, { notes: trimmed });
    } catch {
      if (savedNotes.current === trimmed) savedNotes.current = previous;
    }
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      const trimmed = draftRef.current.trim();
      if (trimmed === savedNotes.current) return;
      savedNotes.current = trimmed;
      void onSaveRef.current(taskRef.current, { notes: trimmed }).catch(() => undefined);
    };
  }, []);

  function scheduleNotes(value: string) {
    draftRef.current = value;
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void commitNotes(draftRef.current);
    }, 500);
  }

  async function saveOwner(assigneeUserId: string | null) {
    if (assigneeUserId === task.assigneeUserId) return;
    try {
      await onSave(task, { assigneeUserId });
    } catch {
      // The board surfaces the error under the list.
    }
  }

  async function saveDue(dueAt: string | null) {
    if (dueAt === task.dueAt) return;
    try {
      await onSave(task, { dueAt });
    } catch {
      // The board surfaces the error under the list.
    }
  }

  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  }, [id]);

  return (
    <div id={id} className="whiteboard-task-edit" data-testid={`task-edit-${task.number}`}>
      <div className="whiteboard-task-fields">
        <label className="whiteboard-field">
          <span>Owner</span>
          <select
            aria-label={`Owner for ${task.title}`}
            data-testid={`task-owner-${task.number}`}
            className="whiteboard-select whiteboard-field-control"
            value={task.assigneeUserId ?? ""}
            disabled={locked}
            onChange={(event) => {
              const value = event.target.value;
              void saveOwner(value ? value : null);
            }}
          >
            <option value="">Unassigned</option>
            {task.assigneeUserId && !knownOwner ? (
              <option value={task.assigneeUserId}>Assigned</option>
            ) : null}
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="whiteboard-field">
          <span>Due</span>
          <input
            type="date"
            aria-label={`Due date for ${task.title}`}
            data-testid={`task-due-${task.number}`}
            className="whiteboard-select whiteboard-field-control"
            value={task.dueAt ?? ""}
            disabled={locked}
            onChange={(event) => {
              const value = event.target.value;
              void saveDue(value ? value : null);
            }}
          />
        </label>
      </div>
      <label className="whiteboard-field">
        <span>Notes</span>
        <textarea
          aria-label={`Notes for ${task.title}`}
          data-testid={`task-notes-${task.number}`}
          className="whiteboard-notes"
          rows={3}
          maxLength={4000}
          value={draft}
          disabled={locked}
          placeholder="Notes"
          onChange={(event) => scheduleNotes(event.target.value)}
          onBlur={() => {
            void commitNotes(draftRef.current);
          }}
        />
      </label>
    </div>
  );
}
