"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DinaAvatar } from "@/components/chat/DinaAvatar";

type Status = "online" | "offline" | "degraded" | "checking";

export function ChatHeader({
  assistantName = "Dina",
  assistantSubtitle = "Chief of staff",
  avatarUrl,
  status,
  microsoftEnabled = false,
  googleEnabled = false,
  dayUsageLabel,
  pushSupported,
  pushEnabled,
  pushBusy,
  onEnablePush,
  onTestPush,
  onSignOut,
}: {
  assistantName?: string;
  assistantSubtitle?: string;
  avatarUrl?: string | null;
  status: Status;
  microsoftEnabled?: boolean;
  googleEnabled?: boolean;
  /** e.g. "Today ~$0.12" */
  dayUsageLabel?: string | null;
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
          {avatarUrl && !avatarUrl.includes("dina-avatar") ? (
            // eslint-disable-next-line @next/next/no-img-element -- static assistant portrait
            <img
              src={avatarUrl}
              alt={assistantName}
              className="h-9 w-9 shrink-0 rounded-full object-cover bg-black"
            />
          ) : (
            <DinaAvatar size="md" className="dina-avatar-glow" />
          )}
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">
                {assistantName}
              </h1>
              <span className="hidden text-xs text-[var(--muted)] sm:inline">
                {assistantSubtitle}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--muted)]">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              <span>{statusLabel}</span>
              {microsoftEnabled && <span className="hidden sm:inline">· M365</span>}
              {googleEnabled && <span className="hidden sm:inline">· Google</span>}
              {dayUsageLabel && (
                <span
                  className="tabular-nums text-[var(--muted)]"
                  title="Estimated OpenAI spend today (America/Denver), from local usage log"
                >
                  · {dayUsageLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        <HeaderActions
          pushSupported={pushSupported}
          pushEnabled={pushEnabled}
          pushBusy={pushBusy}
          onEnablePush={onEnablePush}
          onTestPush={onTestPush}
          onSignOut={onSignOut}
        />
      </div>
    </header>
  );
}

function HeaderActions({
  pushSupported,
  pushEnabled,
  pushBusy,
  onEnablePush,
  onTestPush,
  onSignOut,
}: {
  pushSupported: boolean;
  pushEnabled: boolean;
  pushBusy: boolean;
  onEnablePush: () => void;
  onTestPush: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
      >
        Actions
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-30 mt-1 min-w-48 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
        >
          {pushSupported && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={pushBusy || pushEnabled}
                onClick={() => run(onEnablePush)}
                className="block w-full px-3 py-2 text-left text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                {pushEnabled ? "Notifications on" : "Enable notifications"}
              </button>
              {pushEnabled && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pushBusy}
                  onClick={() => run(onTestPush)}
                  className="block w-full px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--background)] disabled:opacity-50"
                >
                  Test push
                </button>
              )}
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onSignOut)}
            className="block w-full px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--background)]"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
