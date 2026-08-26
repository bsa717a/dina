"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AttentionPanel } from "@/components/chat/AttentionPanel";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import type { RemainingStripTask } from "@/components/chat/ProjectRemainingStrip";
import type { UserProject } from "@/components/chat/ProjectsPill";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatMessage, ChatUsage } from "@/components/chat/types";
import {
  registerServiceWorker,
  subscribeToPush,
  watchInstallPrompt,
} from "@/lib/client/pwa";
import { applyPwaIdentity, pwaIdentityForKey } from "@/lib/pwa/identity";
import { formatDayUsage } from "@/lib/client/usage-format";
import {
  filterRemainingTaskChatMessages,
  isRemainingTasksListForProject,
} from "@/lib/project-tasks/format";

function dragEventHasFiles(
  e: Pick<DragEvent, "dataTransfer"> | Pick<React.DragEvent, "dataTransfer">,
) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // DOMStringList in older engines doesn't always have Array.includes.
  return Array.from(types as ArrayLike<string>).includes("Files");
}

declare global {
  interface Window {
    __dinaPendingDropFiles?: File[];
    __dinaFileDropHandler?: ((files: File[] | FileList) => void) | null;
  }
}

type Status = "online" | "offline" | "degraded" | "checking";

type StreamEvent = {
  type: string;
  text?: string;
  message?: ChatMessage;
  status?: string;
  detail?: string;
  error?: string;
  usage?: ChatUsage;
  dayUsage?: ChatUsage;
  dayUsageLabel?: string;
};

function serializeTaskMessage(message: {
  id: string;
  role: ChatMessage["role"] | string;
  content: string;
  createdAt: string | Date;
  attachments?: ChatMessage["attachments"];
}): ChatMessage {
  return {
    id: message.id,
    role: message.role as ChatMessage["role"],
    content: message.content,
    createdAt:
      typeof message.createdAt === "string"
        ? message.createdAt
        : new Date(message.createdAt).toISOString(),
    attachments: message.attachments ?? [],
  };
}

function activeProjectStorageKey(userId: string) {
  return `dina.activeProject.${userId}`;
}

function readStoredActiveProject(
  userId: string,
  projects: UserProject[],
): UserProject | null {
  try {
    const raw = window.localStorage.getItem(activeProjectStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { key?: unknown; name?: unknown };
    if (typeof parsed?.key !== "string" || typeof parsed?.name !== "string") {
      return null;
    }
    return projects.find((project) => project.key === parsed.key) ?? null;
  } catch {
    return null;
  }
}

function writeStoredActiveProject(userId: string, project: UserProject | null) {
  const key = activeProjectStorageKey(userId);
  if (project) window.localStorage.setItem(key, JSON.stringify(project));
  else window.localStorage.removeItem(key);
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function ChatApp() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState("On it…");
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [attentionHighlight, setAttentionHighlight] = useState<string | null>(
    null,
  );
  const [starBusyId, setStarBusyId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dayUsageLabel, setDayUsageLabel] = useState<string | null>(null);
  const [assistantName, setAssistantName] = useState("Dina");
  const [assistantKey, setAssistantKey] = useState<string | null>(null);
  const [assistantAvatarUrl, setAssistantAvatarUrl] = useState<string | null>(
    null,
  );
  const [userRole, setUserRole] = useState<"owner" | "member" | null>(null);
  const [projects, setProjects] = useState<UserProject[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<UserProject | null>(
    null,
  );
  const [remainingTasks, setRemainingTasks] = useState<
    RemainingStripTask[] | null
  >(null);
  const [remainingLoading, setRemainingLoading] = useState(false);
  const [remainingError, setRemainingError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);
  const sendingRef = useRef(false);
  const remainingTasksRequestRef = useRef(0);
  const remainingTasksAbortRef = useRef<AbortController | null>(null);
  const remainingPostInFlightRef = useRef(false);
  const conversationLoadRequestRef = useRef(0);
  const conversationLoadPendingRef = useRef(false);
  const selectedProjectRef = useRef<UserProject | null>(null);
  const showRemainingTasksRef = useRef<
    (
      project: UserProject,
      options?: { quiet?: boolean; postToChat?: boolean },
    ) => Promise<void>
  >(async () => undefined);
  selectedProjectRef.current = selectedProject;
  const dragDepthRef = useRef(0);
  const thinkingRef = useRef(thinking);
  const usageByMessageIdRef = useRef<Map<string, ChatUsage>>(new Map());
  thinkingRef.current = thinking;

  // file-drop-guard.js blocks navigation early; this wires drops into Composer.
  useEffect(() => {
    const acceptFiles = (files: File[] | FileList) => {
      if (thinkingRef.current || sendingRef.current) return;
      const list = Array.from(files);
      if (!list.length) return;
      dragDepthRef.current = 0;
      setDragActive(false);
      composerRef.current?.addFiles(list);
    };

    window.__dinaFileDropHandler = acceptFiles;
    const pending = window.__dinaPendingDropFiles || [];
    if (pending.length) {
      window.__dinaPendingDropFiles = [];
      acceptFiles(pending);
    }

    const onDragEnter = (e: DragEvent) => {
      if (!dragEventHasFiles(e) || thinkingRef.current || sendingRef.current)
        return;
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onDragLeave = () => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<{ files?: File[] }>).detail;
      if (detail?.files?.length) acceptFiles(detail.files);
    };

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("dina:files-dropped", onCustom);
    return () => {
      if (window.__dinaFileDropHandler === acceptFiles) {
        window.__dinaFileDropHandler = null;
      }
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("dina:files-dropped", onCustom);
    };
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (!navigator.onLine) setStatus("offline");
      else if (data.status === "ok") setStatus("online");
      else setStatus("degraded");
    } catch {
      setStatus(navigator.onLine ? "degraded" : "offline");
    }
  }, []);

  const refreshDayUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/today");
      if (!res.ok) return;
      const data = (await res.json()) as { totals?: ChatUsage };
      if (data.totals) setDayUsageLabel(formatDayUsage(data.totals));
    } catch {
      // Non-critical
    }
  }, []);

  const loadConversation = useCallback(async () => {
    const requestId = ++conversationLoadRequestRef.current;
    conversationLoadPendingRef.current = true;
    try {
      const res = await fetch("/api/conversations");
      if (requestId !== conversationLoadRequestRef.current) return;
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      if (requestId !== conversationLoadRequestRef.current) return;
      if (!res.ok) throw new Error(data.error || "Failed to load conversation");
      const mapped: ChatMessage[] = (data.messages || []).map(
        (m: ChatMessage & { starredAt?: string | null }) => ({
          ...m,
          starred: Boolean(m.starred ?? m.starredAt),
          createdAt:
            typeof m.createdAt === "string"
              ? m.createdAt
              : new Date(m.createdAt).toISOString(),
          usage: usageByMessageIdRef.current.get(m.id),
        }),
      );
      if (requestId !== conversationLoadRequestRef.current) return;
      if (remainingPostInFlightRef.current) return;
      setMessages(
        filterRemainingTaskChatMessages(
          mapped,
          selectedProjectRef.current?.name,
        ),
      );
      conversationLoadPendingRef.current = false;
      const project = selectedProjectRef.current;
      if (project && !remainingPostInFlightRef.current) {
        void showRemainingTasksRef.current(project, { quiet: true });
      }
    } catch (err) {
      if (requestId !== conversationLoadRequestRef.current) return;
      conversationLoadPendingRef.current = false;
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    }
  }, [router]);

  const handleToggleStar = useCallback(
    async (message: ChatMessage) => {
      if (!message.id || message.pending) return;
      setStarBusyId(message.id);
      setError(null);
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(message.id)}/star`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred: !message.starred }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          count?: number;
          cap?: number;
        };
        if (!res.ok || !data.ok) {
          throw new Error(
            data.error ||
              (res.status === 409
                ? "Star limit reached. Unstar something first."
                : "Could not update star."),
          );
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === message.id
              ? {
                  ...m,
                  starred: !message.starred,
                  starredAt: !message.starred ? new Date().toISOString() : null,
                }
              : m,
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update star.");
      } finally {
        setStarBusyId(null);
      }
    },
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const attention = params.get("attention");
    if (attention) setAttentionHighlight(attention);
  }, []);

  useEffect(() => {
    void loadConversation();
    void refreshHealth();
    void refreshDayUsage();
    const id = window.setInterval(() => void refreshHealth(), 30_000);
    const onOnline = () => void refreshHealth();
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    watchInstallPrompt();
    void (async () => {
      await registerServiceWorker();
      const supported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;
      setPushSupported(supported);
      const cfg = await fetch("/api/config");
      if (cfg.ok) {
        const data = await cfg.json();
        setVapidPublicKey(data.vapidPublicKey);
        setMicrosoftEnabled(Boolean(data.microsoftEnabled));
        setGoogleEnabled(Boolean(data.googleEnabled));
        if (typeof data.user?.id === "string") setUserId(data.user.id);
        if (data.user?.assistantName) setAssistantName(data.user.assistantName);
        if (typeof data.user?.assistantKey === "string") {
          setAssistantKey(data.user.assistantKey);
          applyPwaIdentity(pwaIdentityForKey(data.user.assistantKey));
        }
        if (typeof data.user?.avatarUrl === "string") {
          setAssistantAvatarUrl(data.user.avatarUrl);
        }
        if (data.user?.role === "owner" || data.user?.role === "member") {
          setUserRole(data.user.role);
        }
        if (Array.isArray(data.projects)) {
          const next = data.projects.filter(
            (project: { key?: unknown; name?: unknown }): project is UserProject =>
              typeof project?.key === "string" && typeof project?.name === "string",
          );
          setProjects(next);
          if (typeof data.user?.id === "string") {
            const stored = readStoredActiveProject(data.user.id, next);
            selectedProjectRef.current = stored;
            setSelectedProject(stored);
            if (stored) {
              void loadConversation();
              void showRemainingTasksRef.current(stored, { quiet: true });
            }
          }
        }
        if (supported && data.vapidPublicKey && Notification.permission === "granted") {
          const reg = await navigator.serviceWorker.ready;
          const existing = await reg.pushManager.getSubscription();
          setPushEnabled(Boolean(existing));
        }
      }
    })();

    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [loadConversation, refreshHealth, refreshDayUsage]);

  function clearRemainingStrip(options?: { keepRequest?: boolean }) {
    if (!options?.keepRequest) {
      remainingTasksAbortRef.current?.abort();
      remainingTasksRequestRef.current += 1;
    }
    setRemainingTasks(null);
    setRemainingError(null);
    setRemainingLoading(false);
  }

  useEffect(() => {
    if (!selectedProject) return;
    if (projects.some((project) => project.key === selectedProject.key)) return;
    selectedProjectRef.current = null;
    setSelectedProject(null);
    if (userId) writeStoredActiveProject(userId, null);
    clearRemainingStrip();
  }, [projects, selectedProject, userId]);

  async function showRemainingTasks(
    project: UserProject,
    options?: { quiet?: boolean; postToChat?: boolean },
  ) {
    if (options?.quiet && remainingPostInFlightRef.current) return;

    let requestId = remainingTasksRequestRef.current;
    let controller: AbortController | null = null;
    if (options?.quiet) {
      if (remainingTasksAbortRef.current) return;
    } else {
      requestId = ++remainingTasksRequestRef.current;
      remainingTasksAbortRef.current?.abort();
      controller = new AbortController();
      remainingTasksAbortRef.current = controller;
      setRemainingError(null);
      setRemainingLoading(true);
      if (options?.postToChat) {
        remainingPostInFlightRef.current = true;
        conversationLoadRequestRef.current += 1;
      }
    }

    try {
      const res = options?.postToChat
        ? await fetch("/api/project-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project: project.key }),
            signal: controller?.signal,
          })
        : await fetch(
            `/api/project-tasks?project=${encodeURIComponent(project.key)}`,
            { signal: controller?.signal },
          );
      if (requestId !== remainingTasksRequestRef.current) return;
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        tasks?: Array<{ number?: unknown; title?: unknown }>;
        message?: {
          id: string;
          role: ChatMessage["role"] | string;
          content: string;
          createdAt: string | Date;
          attachments?: ChatMessage["attachments"];
        };
      };
      if (requestId !== remainingTasksRequestRef.current) return;
      const tasks = Array.isArray(data.tasks)
        ? data.tasks.filter(
            (task): task is RemainingStripTask =>
              typeof task.number === "number" && typeof task.title === "string",
          )
        : null;
      if (!res.ok || !tasks) {
        if (res.status === 400 && /project/i.test(String(data.error || ""))) {
          selectedProjectRef.current = null;
          setSelectedProject(null);
          if (userId) writeStoredActiveProject(userId, null);
          clearRemainingStrip({ keepRequest: true });
        }
        throw new Error(data.error || "Could not load tasks.");
      }
      setRemainingTasks(tasks);
      setRemainingError(null);
      setRemainingLoading(false);
      if (options?.postToChat && data.message) {
        const next = serializeTaskMessage(data.message);
        setMessages((prev) =>
          filterRemainingTaskChatMessages(
            [...prev.filter((message) => message.id !== next.id), next],
            project.name,
          ),
        );
        if (conversationLoadPendingRef.current) {
          void loadConversation();
        }
      }
    } catch (err) {
      if (controller?.signal.aborted) return;
      if (requestId !== remainingTasksRequestRef.current) return;
      setRemainingLoading(false);
      if (options?.quiet) return;
      setRemainingError(
        err instanceof Error ? err.message : "Could not load tasks.",
      );
    } finally {
      if (requestId === remainingTasksRequestRef.current) {
        remainingPostInFlightRef.current = false;
        if (controller && remainingTasksAbortRef.current === controller) {
          remainingTasksAbortRef.current = null;
        }
      }
    }
  }
  showRemainingTasksRef.current = showRemainingTasks;

  async function handleSend(input: {
    content: string;
    attachmentIds: string[];
    project?: UserProject | null;
  }) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const tempId = `temp-${crypto.randomUUID()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "user",
        content: input.content || "(attachment)",
        createdAt: new Date().toISOString(),
        attachments: input.attachmentIds.map((id) => ({
          id,
          filename: "attachment",
          mimeType: "image/jpeg",
          size: 0,
        })),
      },
    ]);
    setThinking(true);
    setThinkingLabel("On it…");

    const assistantId = `stream-${crypto.randomUUID()}`;
    let started = false;

    try {
      const project =
        input.project !== undefined ? input.project : selectedProject;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: input.content,
          attachmentIds: input.attachmentIds,
          ...(project ? { project: project.key } : {}),
        }),
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 400 && /project/i.test(String(data.error || ""))) {
          selectedProjectRef.current = null;
          setSelectedProject(null);
          if (userId) writeStoredActiveProject(userId, null);
          clearRemainingStrip();
        }
        throw new Error(data.error || "Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const line = chunk
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          if (!line) continue;
          const event = JSON.parse(line) as StreamEvent;

          if (event.type === "status") {
            setThinking(true);
            if (event.detail) setThinkingLabel(event.detail);
            else if (event.status === "tool") setThinkingLabel("Working on it…");
            else if (event.status === "working") setThinkingLabel("Working on it…");
            else setThinkingLabel("On it…");
          }

          if (event.type === "delta" && event.text) {
            if (!started) {
              started = true;
              setThinking(false);
              setMessages((prev) => [
                ...prev,
                {
                  id: assistantId,
                  role: "assistant",
                  content: event.text || "",
                  createdAt: new Date().toISOString(),
                  pending: true,
                },
              ]);
            } else {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + (event.text || "") }
                    : m,
                ),
              );
            }
          }

          if (event.type === "done" && event.message) {
            setThinking(false);
            const turnUsage = event.usage || event.message.usage;
            if (turnUsage && event.message.id) {
              usageByMessageIdRef.current.set(event.message.id, turnUsage);
            }
            if (event.dayUsage) {
              setDayUsageLabel(formatDayUsage(event.dayUsage));
            } else {
              void refreshDayUsage();
            }
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            void loadConversation();
          }

          if (event.type === "error") {
            throw new Error(event.error || "Chat failed");
          }
        }
      }
    } catch (err) {
      setThinking(false);
      setMessages((prev) => prev.filter((m) => m.id !== tempId && m.id !== assistantId));
      setError(err instanceof Error ? err.message : "Chat failed");
      throw err;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  async function enablePush() {
    if (!vapidPublicKey) {
      setError("Push notifications are not configured on the server.");
      return;
    }
    setPushBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Notification permission was not granted.");
        return;
      }
      await subscribeToPush(urlBase64ToUint8Array(vapidPublicKey));
      setPushEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable notifications");
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    setPushBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test push failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test push failed");
    } finally {
      setPushBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const selectedForUi = selectedProject
    ? (projects.find((project) => project.key === selectedProject.key) ??
      selectedProject)
    : null;

  return (
    <div className="relative flex h-[100dvh] flex-col bg-[var(--background)]">
      {dragActive && (
        <div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-[var(--accent)] bg-[var(--background)]/85 backdrop-blur-sm">
          <div className="rounded-2xl bg-[var(--accent-soft)] px-5 py-3 text-center">
            <p className="text-base font-medium text-[var(--accent)]">
              Drop to upload
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Photos, PDFs, and text files
            </p>
          </div>
        </div>
      )}
      <ChatHeader
        assistantName={assistantName}
        assistantKey={assistantKey}
        assistantSubtitle={
          userRole === "member" ? "Project assistant" : "Chief of staff"
        }
        avatarUrl={assistantAvatarUrl}
        status={status}
        microsoftEnabled={microsoftEnabled}
        googleEnabled={googleEnabled}
        dayUsageLabel={dayUsageLabel}
        pushSupported={
          userRole !== "member" && pushSupported && Boolean(vapidPublicKey)
        }
        pushEnabled={pushEnabled}
        pushBusy={pushBusy}
        onEnablePush={() => void enablePush()}
        onTestPush={() => void testPush()}
        onSignOut={() => void signOut()}
      />
      {error && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-2 sm:px-6">
          <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        </div>
      )}
      {userRole === "owner" && (
        <AttentionPanel
          highlightId={attentionHighlight}
          onError={(message) => setError(message)}
        />
      )}
      <MessageList
        messages={messages}
        thinking={thinking}
        thinkingLabel={thinkingLabel}
        assistantName={assistantName}
        avatarUrl={assistantAvatarUrl}
        onToggleStar={handleToggleStar}
        starBusyId={starBusyId}
      />
      <Composer
        ref={composerRef}
        disabled={thinking || sending}
        projects={projects}
        selectedProject={selectedForUi}
        remainingTasks={remainingTasks}
        remainingLoading={remainingLoading}
        remainingError={remainingError}
        onSelectProject={(project) => {
          if (sendingRef.current) return;
          const changed = project?.key !== selectedProject?.key;
          selectedProjectRef.current = project;
          setSelectedProject(project);
          if (userId) writeStoredActiveProject(userId, project);
          if (!project) {
            clearRemainingStrip();
            setMessages((prev) => filterRemainingTaskChatMessages(prev, null));
            return;
          }
          const alreadyListed = messages.some((message) =>
            isRemainingTasksListForProject(
              message.role,
              message.content,
              project.name,
            ),
          );
          if (changed) {
            setRemainingTasks(null);
            setRemainingError(null);
          }
          if (changed || !alreadyListed) {
            void showRemainingTasks(project, { postToChat: true });
            return;
          }
          void showRemainingTasks(project);
        }}
        onSend={handleSend}
      />
    </div>
  );
}
