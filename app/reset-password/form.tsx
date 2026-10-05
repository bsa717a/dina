"use client";

import { FormEvent, useState } from "react";
import { DinaAvatar } from "@/components/chat/DinaAvatar";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword: password,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Could not reset password.",
        );
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="dina-ambient flex min-h-[100dvh] items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-start gap-4">
          <DinaAvatar size="xl" className="dina-avatar-glow" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Choose a new password</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              Use at least 10 characters. This replaces the password on the account.
            </p>
          </div>
        </div>

        {!token ? (
          <p className="mt-8 text-sm leading-relaxed text-[var(--danger)]">
            This reset link is missing or invalid.
          </p>
        ) : done ? (
          <>
            <p className="mt-8 text-sm leading-relaxed text-[var(--muted)]">
              Password updated. Sign in with the new one.
            </p>
            <a
              href="/login"
              className="mt-5 block w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-center text-sm font-medium text-white dark:text-[#102019]"
            >
              Sign in
            </a>
          </>
        ) : (
          <form onSubmit={onSubmit} className="mt-8">
            <label className="block text-sm text-[var(--muted)]" htmlFor="new-password">
              New password
            </label>
            <input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
              minLength={10}
              autoFocus
              required
            />
            <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="confirm-password">
              Confirm password
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
              disabled={loading || password.length < 10 || confirmPassword.length < 10}
              className="mt-5 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
            >
              {loading ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
