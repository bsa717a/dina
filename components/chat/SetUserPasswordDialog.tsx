"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

export function SetUserPasswordDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/team/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, newPassword, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Could not set that password.",
        );
      }
      setSavedUsername(typeof data.username === "string" ? data.username : username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set that password.");
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold tracking-tight">
          Set a user&apos;s password
        </h2>
        {savedUsername ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Password updated for {savedUsername}. They can sign in with it.
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white dark:text-[#102019]"
              onClick={onClose}
            >
              Done
            </button>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              Enter their username and a new password of at least 10 characters.
            </p>
            <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="teammate-username">
              Username
            </label>
            <input
              id="teammate-username"
              name="username"
              type="text"
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
              autoFocus
              required
            />
            <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="teammate-new-password">
              New password
            </label>
            <input
              id="teammate-new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
              minLength={10}
              required
            />
            <label
              className="mt-4 block text-sm text-[var(--muted)]"
              htmlFor="teammate-confirm-password"
            >
              Confirm new password
            </label>
            <input
              id="teammate-confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
              minLength={10}
              required
            />
            {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  loading ||
                  !username.trim() ||
                  newPassword.length < 10 ||
                  confirmPassword.length < 10
                }
                className="flex-1 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
              >
                {loading ? "Saving…" : "Update"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
