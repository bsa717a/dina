"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ProjectRemainingStrip,
  type RemainingStripTask,
} from "@/components/chat/ProjectRemainingStrip";
import { ProjectsPill, type UserProject } from "@/components/chat/ProjectsPill";
import type { ChatAttachment } from "@/components/chat/types";

type PendingFile = {
  localId: string;
  file: File;
  previewUrl?: string;
  uploading?: boolean;
  error?: string;
  attachment?: ChatAttachment;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export type ComposerHandle = {
  addFiles: (files: FileList | File[] | null | undefined) => void;
};

export const Composer = forwardRef<
  ComposerHandle,
  {
    disabled?: boolean;
    projects?: UserProject[];
    selectedProject?: UserProject | null;
    remainingTasks?: RemainingStripTask[] | null;
    remainingLoading?: boolean;
    remainingError?: string | null;
    projectSelectDisabled?: boolean;
    onSelectProject?: (project: UserProject | null) => void;
    onShowRemaining?: () => void;
    onSend: (input: { content: string; attachmentIds: string[] }) => Promise<void>;
  }
>(function Composer(
  {
    disabled,
    projects = [],
    selectedProject = null,
    remainingTasks = null,
    remainingLoading,
    remainingError,
    projectSelectDisabled,
    onSelectProject,
    onShowRemaining,
    onSend,
  },
  ref,
) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSpeechSupported(
      typeof window !== "undefined" &&
        Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    );
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 160;
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  useEffect(() => {
    return () => {
      for (const item of pending) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      recognitionRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadFile(file: File) {
    const localId = crypto.randomUUID();
    const previewUrl = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : undefined;
    setPending((prev) => [...prev, { localId, file, previewUrl, uploading: true }]);

    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setPending((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? {
                ...item,
                uploading: false,
                attachment: data.attachment,
              }
            : item,
        ),
      );
    } catch (err) {
      setPending((prev) =>
        prev.map((item) =>
          item.localId === localId
            ? {
                ...item,
                uploading: false,
                error: err instanceof Error ? err.message : "Upload failed",
              }
            : item,
        ),
      );
    }
  }

  function onFilesSelected(files: FileList | File[] | null | undefined) {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    list.forEach((file) => void uploadFile(file));
  }

  useImperativeHandle(ref, () => ({
    addFiles: onFilesSelected,
  }));

  function removePending(localId: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  }

  function toggleMic() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join(" ");
      setText((prev) => (prev ? `${prev.trim()} ${transcript}` : transcript));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function handleSend() {
    setError(null);
    if (pending.some((p) => p.uploading)) {
      setError("Wait for uploads to finish.");
      return;
    }
    if (pending.some((p) => p.error)) {
      setError("Remove failed attachments before sending.");
      return;
    }
    const attachmentIds = pending
      .map((p) => p.attachment?.id)
      .filter((id): id is string => Boolean(id));
    const content = text.trim();
    if (!content && attachmentIds.length === 0) return;

    setText("");
    const snapshot = pending;
    setPending([]);
    try {
      await onSend({ content, attachmentIds });
      for (const item of snapshot) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    } catch (err) {
      setPending(snapshot);
      setError(err instanceof Error ? err.message : "Failed to send");
    }
  }

  return (
    <div className="relative border-t border-[var(--border)] bg-[var(--composer)] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {pending.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {pending.map((item) => (
              <div
                key={item.localId}
                className="relative min-w-[88px] max-w-[140px] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2"
              >
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="mb-1 h-16 w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="mb-1 truncate text-xs text-[var(--muted)]">
                    {item.file.name}
                  </div>
                )}
                <div className="truncate text-[11px] text-[var(--muted)]">
                  {item.uploading ? "Uploading…" : item.error || item.file.name}
                </div>
                <button
                  type="button"
                  onClick={() => removePending(item.localId)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--foreground)] text-[10px] text-[var(--background)]"
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="mb-2 text-xs text-[var(--danger)]">{error}</p>}

        <div className="mb-2">
          <ProjectsPill
            projects={projects}
            selected={selectedProject}
            disabled={projectSelectDisabled}
            onSelectProject={onSelectProject}
            onShowRemaining={onShowRemaining}
          />
          {selectedProject && (
            <ProjectRemainingStrip
              key={selectedProject.key}
              projectName={selectedProject.name}
              tasks={remainingTasks}
              loading={remainingLoading}
              error={remainingError}
            />
          )}
        </div>

        <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 shadow-[var(--shadow)]">
          <div className="flex shrink-0 gap-1 pb-0.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-40"
              aria-label="Attach file"
              title="Attach file"
            >
              <PaperclipIcon />
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={disabled}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] disabled:opacity-40 sm:hidden"
              aria-label="Take photo"
              title="Take photo"
            >
              <CameraIcon />
            </button>
            {speechSupported && (
              <button
                type="button"
                onClick={toggleMic}
                disabled={disabled}
                className={`flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40 ${
                  listening
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                }`}
                aria-label="Voice input"
                title="Voice input"
              >
                <MicIcon />
              </button>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder={
              selectedProject
                ? `What’s on your mind about ${selectedProject.name}?`
                : "What’s on your mind?"
            }
            disabled={disabled}
            className="max-h-40 min-h-[40px] flex-1 resize-none overflow-hidden bg-transparent px-1 py-2 text-[15px] leading-5 outline-none placeholder:text-[var(--muted)] disabled:opacity-50"
          />

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={disabled || (!text.trim() && pending.length === 0)}
            className="mb-0.5 flex h-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] px-3.5 text-sm font-medium text-white disabled:opacity-40 dark:text-[#102019]"
          >
            Send
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            onFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            onFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
});

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12.5 12.5 21a5 5 0 0 1-7.1-7.1L14 5.3a3.2 3.2 0 0 1 4.5 4.5L9.8 18.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.5h2.2l1.3-2h7l1.3 2H20a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
