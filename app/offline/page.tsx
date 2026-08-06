export default function OfflinePage() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-[var(--background)] px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Dina</h1>
      <p className="mt-3 max-w-sm text-sm text-[var(--muted)]">
        You appear to be offline. Reconnect to continue the conversation.
      </p>
    </main>
  );
}
