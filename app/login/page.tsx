"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
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
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--background)] px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm"
        autoComplete="current-password"
      >
        <h1 className="text-3xl font-semibold tracking-tight">Dina</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Enter your access code to continue.
        </p>

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
