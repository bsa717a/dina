"use client";

import { FormEvent, useState } from "react";
import { DinaAvatar } from "@/components/chat/DinaAvatar";

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not send a reset link.");
      }
      setMessage(
        typeof data.message === "string"
          ? data.message
          : "If that account has an email on file, we sent a reset link.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a reset link.");
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
            <h1 className="text-3xl font-semibold tracking-tight">Forgot password</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              Enter your username. If we have an email for that account, we&apos;ll send a reset link.
            </p>
          </div>
        </div>

        {message ? (
          <>
            <p className="mt-8 text-sm leading-relaxed text-[var(--muted)]">{message}</p>
            <a
              href="/login"
              className="mt-5 block w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-center text-sm font-medium text-white dark:text-[#102019]"
            >
              Back to sign in
            </a>
          </>
        ) : (
          <form onSubmit={onSubmit} className="mt-8">
            <label className="block text-sm text-[var(--muted)]" htmlFor="username">
              Username or email
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
            {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
            <button
              type="submit"
              disabled={loading || !username.trim()}
              className="mt-5 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <a
              href="/login"
              className="mt-4 block text-center text-sm text-[var(--muted)] hover:underline"
            >
              Back to sign in
            </a>
          </form>
        )}
      </div>
    </main>
  );
}
