"use client";

import { useCallback, useEffect, useId, useState } from "react";

export type AttentionItemView = {
  id: string;
  source: string;
  sourceId?: string;
  category: string;
  categoryLabel: string;
  sender: string | null;
  subject: string | null;
  summary: string;
  whyItMatters: string;
  recommendedAction: string;
  shouldDraftReply: boolean;
  /** True for email/meeting drafts that Attention can send via Microsoft Graph. */
  canSendDraft?: boolean;
  draftSubject: string | null;
  draftBody: string | null;
  isBlocking: boolean;
  hasDeadline: boolean;
  deadlineAt: string | null;
  occursAt: string | null;
  occursEndAt: string | null;
  whenLabel: string | null;
  connector?: string | null;
  accountLabel?: string | null;
  accountEmail?: string | null;
  githubAccountId: string | null;
  githubAccountLabel: string | null;
  githubRepoKey: string | null;
};

function accountBadge(item: AttentionItemView): string | null {
  if (item.githubAccountLabel) return `GitHub · ${item.githubAccountLabel}`;
  if (item.accountLabel === "personal" || item.connector === "google") {
    return item.accountEmail
      ? `Personal · ${item.accountEmail}`
      : "Personal";
  }
  if (item.accountLabel === "work" || item.connector === "microsoft365") {
    return item.accountEmail ? `Work · ${item.accountEmail}` : "Work";
  }
  return null;
}

type EmailAddressView = {
  name: string | null;
  address: string | null;
  display: string;
};

type FullEmailView = {
  id: string;
  subject: string | null;
  from: EmailAddressView | null;
  to: EmailAddressView[];
  cc: EmailAddressView[];
  receivedDateTime: string | null;
  hasAttachments: boolean;
  importance: string | null;
  bodyText: string;
  bodyTruncated: boolean;
};

function formatReceivedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function joinAddresses(list: EmailAddressView[]): string {
  return list.map((entry) => entry.display).join(", ");
}

type Props = {
  highlightId?: string | null;
  onError?: (message: string) => void;
};

function mergeItem(
  prev: AttentionItemView,
  updated: Partial<{
    summary: string;
    whyItMatters: string;
    recommendedAction: string;
    draftSubject: string | null;
    draftBody: string | null;
    shouldDraftReply: boolean;
  }>,
): AttentionItemView {
  return {
    ...prev,
    summary: updated.summary ?? prev.summary,
    whyItMatters: updated.whyItMatters ?? prev.whyItMatters,
    recommendedAction: updated.recommendedAction ?? prev.recommendedAction,
    draftSubject:
      updated.draftSubject !== undefined
        ? updated.draftSubject
        : prev.draftSubject,
    draftBody:
      updated.draftBody !== undefined ? updated.draftBody : prev.draftBody,
    shouldDraftReply: updated.shouldDraftReply ?? prev.shouldDraftReply,
  };
}

export function AttentionPanel({ highlightId, onError }: Props) {
  const emailTitleId = useId();
  const [items, setItems] = useState<AttentionItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [reviseNote, setReviseNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAllDone, setMarkingAllDone] = useState(false);
  const [emailItemId, setEmailItemId] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [fullEmail, setFullEmail] = useState<FullEmailView | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attention");
      if (!res.ok) {
        if (res.status === 401) return;
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load attention items");
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to load attention");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (highlightId) {
      setExpandedId(highlightId);
      const el = document.getElementById(`attention-${highlightId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [highlightId, items]);

  function beginEdit(item: AttentionItemView) {
    setEditingId(item.id);
    setExpandedId(item.id);
    setDraftSubject(item.draftSubject || `Re: ${item.subject || ""}`);
    setDraftBody(item.draftBody || "");
    setReviseNote("");
    void act(item.id, "reviewed");
  }

  async function beginDraft(item: AttentionItemView) {
    setExpandedId(item.id);
    setReviseNote("");
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/attention/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_draft" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Draft failed");
      if (data.item) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? mergeItem(i, data.item) : i)),
        );
        setDraftSubject(
          data.item.draftSubject || `Re: ${item.subject || ""}`,
        );
        setDraftBody(data.item.draftBody || "");
      } else {
        setDraftSubject(item.draftSubject || `Re: ${item.subject || ""}`);
        setDraftBody(item.draftBody || "");
      }
      setEditingId(item.id);
      void fetch(`/api/attention/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reviewed" }),
      });
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusyId(null);
    }
  }

  function closeEmailModal() {
    setEmailItemId(null);
    setFullEmail(null);
    setEmailError(null);
    setEmailLoading(false);
  }

  async function openEmail(item: AttentionItemView) {
    setEmailItemId(item.id);
    setFullEmail(null);
    setEmailError(null);
    setEmailLoading(true);
    try {
      const res = await fetch(`/api/attention/${item.id}/email`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load email");
      setFullEmail(data.email as FullEmailView);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load email";
      setEmailError(message);
      onError?.(message);
    } finally {
      setEmailLoading(false);
    }
  }

  function closeEditor() {
    setEditingId(null);
  }

  const editingItem = editingId
    ? items.find((item) => item.id === editingId) || null
    : null;
  const editingBusy = Boolean(editingItem && busyId === editingItem.id);

  useEffect(() => {
    if (editingId && !items.some((item) => item.id === editingId)) {
      setEditingId(null);
    }
  }, [editingId, items]);

  useEffect(() => {
    if (!emailItemId && !editingItem) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (emailItemId) closeEmailModal();
      else if (editingItem && busyId !== editingItem.id) closeEditor();
    }
    window.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [emailItemId, editingItem, busyId]);

  async function markAllDone() {
    if (markingAllDone || !items.length) return;
    const count = items.length;
    if (
      !window.confirm(
        `Mark all ${count} attention item${count === 1 ? "" : "s"} done?`,
      )
    ) {
      return;
    }
    setMarkingAllDone(true);
    try {
      const res = await fetch("/api/attention", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to mark all done");
      setItems([]);
      setEditingId(null);
      setExpandedId(null);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to mark all done");
    } finally {
      setMarkingAllDone(false);
    }
  }

  async function act(
    id: string,
    action: string,
    extra?: {
      draftSubject?: string;
      draftBody?: string;
      note?: string;
    },
  ) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/attention/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      if (
        action === "dismissed_unimportant" ||
        action === "blocked_sender" ||
        action === "send_draft" ||
        action === "accepted_recommendation" ||
        action === "snoozed"
      ) {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (editingId === id) setEditingId(null);
      } else if (data.item) {
        setItems((prev) =>
          prev.map((i) => (i.id === id ? mergeItem(i, data.item) : i)),
        );
        if (action === "revise_draft") {
          setDraftSubject(data.item.draftSubject || "");
          setDraftBody(data.item.draftBody || "");
          setReviseNote("");
        }
      }
      if (action === "edited_draft") {
        setEditingId(null);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 pt-3 sm:px-6">
        <p className="text-sm text-[var(--muted)]">Checking what needs your attention…</p>
      </section>
    );
  }

  // Keep rendering overlays even when the open list is empty (e.g. after Send).
  if (!items.length && !editingItem && !emailItemId) return null;

  return (
    <section className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-3 sm:px-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
            Needs Your Attention
          </h2>
          <p className="text-[11px] text-[var(--muted)]">Chief of Staff Engine</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={markingAllDone || Boolean(busyId)}
            className="rounded-xl border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] disabled:opacity-50"
            onClick={() => void markAllDone()}
          >
            {markingAllDone ? "Clearing…" : "Mark all done"}
          </button>
          <span className="text-xs text-[var(--muted)]">{items.length}</span>
        </div>
      </div>
      <ul className="flex max-h-[42vh] flex-col gap-2 overflow-y-auto pb-1">
        {items.map((item) => {
          const open = expandedId === item.id || editingId === item.id;
          const busy = busyId === item.id;
          return (
            <li
              key={item.id}
              id={`attention-${item.id}`}
              className={`rounded-2xl border bg-[var(--surface)] px-3 py-3 shadow-[var(--shadow)] ${
                highlightId === item.id
                  ? "border-[var(--accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() =>
                  setExpandedId((cur) => (cur === item.id ? null : item.id))
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--accent)]">
                    {item.categoryLabel}
                  </span>
                  {accountBadge(item) && (
                    <span className="text-[11px] text-[var(--muted)]">
                      {accountBadge(item)}
                    </span>
                  )}
                  {item.isBlocking && (
                    <span className="text-[11px] text-[var(--danger)]">Blocking</span>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-[var(--foreground)]">
                  {item.sender || "Unknown"}
                  {item.subject ? (
                    <span className="font-normal text-[var(--muted)]">
                      {" "}
                      · {item.subject}
                    </span>
                  ) : null}
                </p>
                {item.whenLabel && (
                  <p className="mt-1 text-sm font-medium text-[var(--accent)]">
                    {item.whenLabel}
                  </p>
                )}
                <p className="mt-1 text-sm text-[var(--foreground)]">{item.summary}</p>
              </button>

              {open && (
                <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 text-sm">
                  {item.whyItMatters ? (
                    <p>
                      <span className="text-[var(--muted)]">Project: </span>
                      {item.whyItMatters}
                    </p>
                  ) : null}
                  <p>
                    <span className="text-[var(--muted)]">Recommended: </span>
                    {item.recommendedAction}
                  </p>

                  {editingId === item.id ? (
                    <p className="text-sm text-[var(--muted)]">
                      Editing in full screen…
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(item.shouldDraftReply || item.draftBody) && (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          onClick={() => void beginDraft(item)}
                        >
                          {busy && !item.draftBody
                            ? "Drafting…"
                            : item.draftBody
                              ? "Review draft"
                              : "Draft reply"}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                        onClick={() => beginEdit(item)}
                      >
                        Edit
                      </button>
                      {item.canSendDraft && (
                        <button
                          type="button"
                          disabled={busy || !item.draftBody}
                          className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                          onClick={() =>
                            void act(item.id, "send_draft", {
                              draftSubject:
                                item.draftSubject ||
                                `Re: ${item.subject || ""}`,
                              draftBody: item.draftBody || "",
                            })
                          }
                        >
                          Send
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                        onClick={() =>
                          void act(item.id, "accepted_recommendation")
                        }
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                        title="Hide for 1 hour"
                        onClick={() => void act(item.id, "snoozed")}
                      >
                        Snooze
                      </button>
                      {item.source === "email" && (
                        <button
                          type="button"
                          disabled={busy || emailLoading}
                          className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
                          onClick={() => void openEmail(item)}
                        >
                          View email
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] disabled:opacity-50"
                        onClick={() =>
                          void act(item.id, "dismissed_unimportant")
                        }
                      >
                        Not important
                      </button>
                      {item.source === "email" && (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--danger)] disabled:opacity-50"
                          onClick={() => {
                            const label = item.sender || "this sender";
                            if (
                              !window.confirm(
                                `Block future Attention from ${label}? Mail stays in the inbox; Dina will stop surfacing it.`,
                              )
                            ) {
                              return;
                            }
                            void act(item.id, "blocked_sender");
                          }}
                        >
                          Block sender
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editingItem && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]"
          role="dialog"
          aria-modal="true"
          aria-label="Edit attention draft"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                {editingItem.categoryLabel}
              </p>
              <h2 className="truncate text-lg font-semibold text-[var(--foreground)]">
                {editingItem.subject || editingItem.summary}
              </h2>
              {editingItem.sender && (
                <p className="truncate text-sm text-[var(--muted)]">
                  {editingItem.sender}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={editingBusy}
              className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={closeEditor}
            >
              Close
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
              {editingItem.whyItMatters ? (
                <p className="text-sm text-[var(--foreground)]">
                  <span className="text-[var(--muted)]">Project: </span>
                  {editingItem.whyItMatters}
                </p>
              ) : null}
              <p className="text-sm text-[var(--foreground)]">
                <span className="text-[var(--muted)]">Recommended: </span>
                {editingItem.recommendedAction}
              </p>
              <input
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                placeholder="Subject"
                autoFocus
              />
              <textarea
                className="min-h-[45vh] w-full flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base leading-relaxed"
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                placeholder={
                  editingItem.source === "github"
                    ? "Review / decision note"
                    : "Draft reply"
                }
              />
              <textarea
                className="min-h-20 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                value={reviseNote}
                onChange={(e) => setReviseNote(e.target.value)}
                placeholder="Notes for Dina (optional) — e.g. shorter, approve Dependabot, ask about tests…"
              />
            </div>
          </div>

          <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
              <button
                type="button"
                disabled={editingBusy}
                className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
                onClick={() =>
                  void act(editingItem.id, "revise_draft", {
                    draftSubject,
                    draftBody,
                    note: reviseNote.trim() || undefined,
                  })
                }
              >
                {editingBusy ? "Revising…" : "Revise with AI"}
              </button>
              {editingItem.canSendDraft && (
                <button
                  type="button"
                  disabled={editingBusy}
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() =>
                    void act(editingItem.id, "send_draft", {
                      draftSubject,
                      draftBody,
                    })
                  }
                >
                  Send
                </button>
              )}
              <button
                type="button"
                disabled={editingBusy}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
                onClick={() =>
                  void act(editingItem.id, "edited_draft", {
                    draftSubject,
                    draftBody,
                  })
                }
              >
                Save edits
              </button>
              {editingItem.source === "email" && (
                <button
                  type="button"
                  disabled={editingBusy || emailLoading}
                  className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() => void openEmail(editingItem)}
                >
                  View email
                </button>
              )}
              <button
                type="button"
                disabled={editingBusy}
                className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] disabled:opacity-50"
                onClick={closeEditor}
              >
                Cancel
              </button>
            </div>
          </footer>
        </div>
      )}

      {emailItemId && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-[var(--background)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={emailTitleId}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs text-[var(--muted)]">Full message</p>
              <h3
                id={emailTitleId}
                className="truncate text-lg font-semibold text-[var(--foreground)]"
              >
                {fullEmail?.subject ||
                  items.find((item) => item.id === emailItemId)?.subject ||
                  "Email"}
              </h3>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-1.5 text-sm"
              onClick={closeEmailModal}
            >
              Close
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-3xl">
              {emailLoading && (
                <p className="text-sm text-[var(--muted)]">Loading email…</p>
              )}
              {emailError && !emailLoading && (
                <p className="text-sm text-[var(--danger)]">{emailError}</p>
              )}
              {fullEmail && !emailLoading && (
                <div className="space-y-4 text-sm">
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                        From
                      </dt>
                      <dd className="break-words text-[var(--foreground)]">
                        {fullEmail.from?.display || "Unknown"}
                      </dd>
                    </div>
                    {fullEmail.to.length > 0 && (
                      <div>
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                          To
                        </dt>
                        <dd className="break-words text-[var(--foreground)]">
                          {joinAddresses(fullEmail.to)}
                        </dd>
                      </div>
                    )}
                    {fullEmail.cc.length > 0 && (
                      <div>
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                          Cc
                        </dt>
                        <dd className="break-words text-[var(--foreground)]">
                          {joinAddresses(fullEmail.cc)}
                        </dd>
                      </div>
                    )}
                    {formatReceivedAt(fullEmail.receivedDateTime) && (
                      <div>
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                          Received
                        </dt>
                        <dd className="text-[var(--foreground)]">
                          {formatReceivedAt(fullEmail.receivedDateTime)}
                        </dd>
                      </div>
                    )}
                    {(fullEmail.hasAttachments ||
                      fullEmail.importance === "high") && (
                      <div className="flex flex-wrap gap-2 pt-1 text-xs text-[var(--muted)]">
                        {fullEmail.hasAttachments && <span>Has attachments</span>}
                        {fullEmail.importance === "high" && (
                          <span className="text-[var(--danger)]">High importance</span>
                        )}
                      </div>
                    )}
                  </dl>
                  <div className="border-t border-[var(--border)] pt-4">
                    <pre className="whitespace-pre-wrap break-words font-sans text-base leading-relaxed text-[var(--foreground)]">
                      {fullEmail.bodyText}
                    </pre>
                    {fullEmail.bodyTruncated && (
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        Body truncated for display.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
