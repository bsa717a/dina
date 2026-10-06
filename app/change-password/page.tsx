"use client";

import { FormEvent, useState } from "react";
import { DinaAvatar } from "@/components/chat/DinaAvatar";

export default function ChangePasswordPage() {
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Could not change password.",
        );
      }
      window.location.assign(data.needsOnboarding ? "/onboarding" : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password.");
      setLoading(false);
    }
  }

  const canSubmit =
    username.trim().length > 0 &&
    currentPassword.length > 0 &&
    newPassword.length >= 10 &&
    confirmPassword.length >= 10;

  return (
    <main className="dina-ambient flex min-h-[100dvh] items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm" autoComplete="on">
        <div className="flex flex-col items-start gap-4">
          <DinaAvatar size="xl" className="dina-avatar-glow" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Change password</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              Enter your username and current password, then choose a new one of at least 10
              characters.
            </p>
          </div>
        </div>

        <label className="mt-8 block text-sm text-[var(--muted)]" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          autoFocus
          required
        />

        <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="current-password">
          Current password
        </label>
        <input
          id="current-password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          required
        />

        <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          minLength={10}
          required
        />

        <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="confirm-password">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          minLength={10}
          required
        />

        {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="mt-5 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
        >
          {loading ? "Saving…" : "Update password"}
        </button>
        <a
          href="/login"
          className="mt-4 block text-center text-sm text-[var(--muted)] hover:underline"
        >
          Back to sign in
        </a>
      </form>
    </main>
  );
}
