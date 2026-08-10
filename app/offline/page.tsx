import { DinaAvatar } from "@/components/chat/DinaAvatar";

export default function OfflinePage() {
  return (
    <main className="dina-ambient flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <DinaAvatar size="lg" className="dina-avatar-glow" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Dina</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
        Looks like you&apos;re offline. Reconnect and I&apos;ll be right here.
      </p>
    </main>
  );
}
