"use client";

import { FormEvent, useState } from "react";
import { DinaAvatar } from "@/components/chat/DinaAvatar";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }
      // Full navigation so Safari sends the new session cookie (client
      // router.replace can race before the cookie is stored).
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="dina-ambient flex min-h-[100dvh] items-center justify-center px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm"
        autoComplete="current-password"
      >
        <div className="flex flex-col items-start gap-4">
          <DinaAvatar size="xl" className="dina-avatar-glow shadow-sm" />
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Dina</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              Your chief of staff. Enter your access code and we&apos;ll pick up
              where things left off.
            </p>
          </div>
        </div>

        <label className="mt-8 block text-sm text-[var(--muted)]" htmlFor="access-code">
          Access code
        </label>
        <input
          id="access-code"
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          autoFocus
          required
        />

        {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

        <button
          type="submit"
          disabled={loading || !code}
          className="mt-5 w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
        >
          {loading ? "Checking…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
