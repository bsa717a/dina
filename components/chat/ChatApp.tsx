"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AttentionPanel } from "@/components/chat/AttentionPanel";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatMessage } from "@/components/chat/types";
import { registerServiceWorker, subscribeToPush } from "@/lib/client/pwa";

type Status = "online" | "offline" | "degraded" | "checking";

type StreamEvent = {
  type: string;
  text?: string;
  message?: ChatMessage;
  status?: string;
  detail?: string;
  error?: string;
};

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
  const [thinkingLabel, setThinkingLabel] = useState("Dina is thinking…");
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null);
  const [attentionHighlight, setAttentionHighlight] = useState<string | null>(
    null,
  );

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

  const loadConversation = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load conversation");
      setMessages(
        (data.messages || []).map((m: ChatMessage) => ({
          ...m,
          createdAt:
            typeof m.createdAt === "string"
              ? m.createdAt
              : new Date(m.createdAt).toISOString(),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    }
  }, [router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const attention = params.get("attention");
    if (attention) setAttentionHighlight(attention);
  }, []);

  useEffect(() => {
    void loadConversation();
    void refreshHealth();
    const id = window.setInterval(() => void refreshHealth(), 30_000);
    const onOnline = () => void refreshHealth();
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

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
  }, [loadConversation, refreshHealth]);

  async function handleSend(input: { content: string; attachmentIds: string[] }) {
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
    setThinkingLabel("Dina is thinking…");

    const assistantId = `stream-${crypto.randomUUID()}`;
    let started = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
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
            else if (event.status === "tool") setThinkingLabel("Using Microsoft 365…");
            else setThinkingLabel("Dina is thinking…");
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

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--background)]">
      <ChatHeader
        status={status}
        microsoftEnabled={microsoftEnabled}
        pushSupported={pushSupported && Boolean(vapidPublicKey)}
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
      <AttentionPanel
        highlightId={attentionHighlight}
        onError={(message) => setError(message)}
      />
      <MessageList
        messages={messages}
        thinking={thinking}
        thinkingLabel={thinkingLabel}
      />
      <Composer disabled={thinking} onSend={handleSend} />
    </div>
  );
}
