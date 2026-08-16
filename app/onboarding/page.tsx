"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AssistantCard = {
  key: string;
  name: string;
  title: string;
  about: string;
  photoUrl: string;
  accent: string;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [assistantKey, setAssistantKey] = useState<string | null>(null);
  const [assistants, setAssistants] = useState<AssistantCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const [assistantsRes, configRes] = await Promise.all([
        fetch("/api/assistants"),
        fetch("/api/config"),
      ]);
      if (assistantsRes.status === 401) {
        router.replace("/login");
        return;
      }
      const config = configRes.ok ? await configRes.json() : null;
      if (config?.user && config.user.needsOnboarding === false) {
        window.location.assign("/");
        return;
      }
      const data = await assistantsRes.json();
      setAssistants(data.assistants || []);
    })();
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!assistantKey) {
      setError("Pick an assistant personality.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword, assistantKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not finish setup.");
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish setup.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="dina-ambient min-h-[100dvh] px-4 py-8 sm:px-6">
      <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">Set up your assistant</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Choose a new password, then pick who you&apos;ll work with. You can&apos;t
          change the personality later.
        </p>

        <label className="mt-8 block text-sm text-[var(--muted)]" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          minLength={10}
          required
        />

        <label className="mt-4 block text-sm text-[var(--muted)]" htmlFor="confirm-password">
          Confirm password
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="mt-2 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 outline-none ring-[var(--accent)] focus:ring-2"
          minLength={10}
          required
        />

        <h2 className="mt-10 text-lg font-semibold">Pick a personality</h2>
        <div className="mt-4 grid gap-4">
          {assistants.map((assistant) => {
            const selected = assistantKey === assistant.key;
            return (
              <button
                key={assistant.key}
                type="button"
                onClick={() => setAssistantKey(assistant.key)}
                className={`overflow-hidden rounded-2xl border text-left transition ${
                  selected
                    ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                    : "border-[var(--border)] hover:border-[var(--accent)]/50"
                }`}
              >
                <img
                  src={assistant.photoUrl}
                  alt={`${assistant.name} — ${assistant.title}`}
                  className="w-full bg-white"
                />
              </button>
            );
          })}
        </div>

        {error && <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>}

        <button
          type="submit"
          disabled={loading || !assistantKey || password.length < 10}
          className="mt-6 w-full max-w-sm rounded-xl bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
        >
          {loading ? "Saving…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
