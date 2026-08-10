"use client";

import { DinaAvatar } from "@/components/chat/DinaAvatar";

type Status = "online" | "offline" | "degraded" | "checking";

export function ChatHeader({
  status,
  microsoftEnabled = false,
  googleEnabled = false,
  pushSupported,
  pushEnabled,
  pushBusy,
  onEnablePush,
  onTestPush,
  onSignOut,
}: {
  status: Status;
  microsoftEnabled?: boolean;
  googleEnabled?: boolean;
  pushSupported: boolean;
  pushEnabled: boolean;
  pushBusy: boolean;
  onEnablePush: () => void;
  onTestPush: () => void;
  onSignOut: () => void;
}) {
  const color =
    status === "online"
      ? "var(--status-ok)"
      : status === "degraded"
        ? "var(--status-warn)"
        : status === "offline"
          ? "var(--status-err)"
          : "var(--muted)";

  const statusLabel =
    status === "checking"
      ? "Connecting"
      : status === "online"
        ? "Here"
        : status === "degraded"
          ? "Degraded"
          : "Offline";

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--background)]/92 backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <DinaAvatar size="md" className="dina-avatar-glow" />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">Dina</h1>
              <span className="hidden text-xs text-[var(--muted)] sm:inline">
                Chief of staff
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              <span>{statusLabel}</span>
              {microsoftEnabled && <span className="hidden sm:inline">· M365</span>}
              {googleEnabled && <span className="hidden sm:inline">· Google</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {pushSupported && (
            <>
              <button
                type="button"
                onClick={onEnablePush}
                disabled={pushBusy || pushEnabled}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                {pushEnabled ? "Notifications on" : "Enable notifications"}
              </button>
              {pushEnabled && (
                <button
                  type="button"
                  onClick={onTestPush}
                  disabled={pushBusy}
                  className="hidden rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface)] sm:inline"
                >
                  Test push
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
