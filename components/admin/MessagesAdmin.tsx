"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

type BlockReason = "no_phone" | "no_consent" | "opted_out";

type MessagingUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  phoneNumber: string | null;
  smsConsentAt: string | null;
  smsConsentMethod: string | null;
  smsConsentBy: { id: string; name: string } | null;
  smsOptedOutAt: string | null;
  canSend: boolean;
  blockReason: BlockReason | null;
  blockMessage: string | null;
};

const CONSENT_METHODS = [
  { value: "verbal", label: "Verbal" },
  { value: "written", label: "Written" },
  { value: "web_form", label: "Web form" },
  { value: "in_person", label: "In person" },
] as const;

function formatWhen(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Denver",
  }).format(new Date(iso));
}

function methodLabel(method: string | null) {
  return CONSENT_METHODS.find((item) => item.value === method)?.label ?? method ?? "";
}

function statusLabel(user: MessagingUser) {
  if (user.smsOptedOutAt) return "Opted out";
  if (!user.phoneNumber) return "No number";
  if (!user.smsConsentAt) return "No consent";
  return "Ready";
}

type UserLoad =
  | { ok: true; users: MessagingUser[] }
  | { ok: false; error: string };

let userLoad: { promise: Promise<UserLoad>; result: UserLoad | null } | null = null;

function readUsers(): Promise<UserLoad> {
  if (typeof window === "undefined") return new Promise(() => {});
  if (userLoad?.result) return Promise.resolve(userLoad.result);
  if (!userLoad) {
    const promise = fetch("/api/admin/messages")
      .then(async (response) => {
        const data = (await response.json()) as {
          users?: MessagingUser[];
          error?: string;
        };
        const result: UserLoad = response.ok
          ? { ok: true, users: data.users ?? [] }
          : { ok: false, error: data.error ?? "Could not load users." };
        if (userLoad) userLoad.result = result;
        return result;
      })
      .catch(() => {
        const result: UserLoad = { ok: false, error: "Could not load users." };
        if (userLoad) userLoad.result = result;
        return result;
      });
    userLoad = { promise, result: null };
  }
  return userLoad.promise;
}

function rememberUsers(users: MessagingUser[]) {
  const result: UserLoad = { ok: true, users };
  if (userLoad) userLoad.result = result;
  else userLoad = { promise: Promise.resolve(result), result };
}

export function MessagesAdmin({ screen }: { screen: "send" | "phone" }) {
  const [snapshot, setSnapshot] = useState<UserLoad | null>(userLoad?.result ?? null);
  if (snapshot === null) {
    void readUsers().then((result) => {
      setSnapshot((current) => current ?? result);
    });
    return <MessagesFrame screen={screen}>Loading teammates…</MessagesFrame>;
  }

  return (
    <MessagesAdminLoaded
      screen={screen}
      initial={snapshot}
      onUsers={(users) => {
        const result: UserLoad = { ok: true, users };
        setSnapshot(result);
        rememberUsers(users);
      }}
    />
  );
}

function MessagesAdminLoaded({
  screen,
  initial,
  onUsers,
}: {
  screen: "send" | "phone";
  initial: UserLoad;
  onUsers: (users: MessagingUser[]) => void;
}) {
  const [users, setUsers] = useState<MessagingUser[]>(initial.ok ? initial.users : []);
  const [loadError, setLoadError] = useState<string | null>(initial.ok ? null : initial.error);
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? "");

  const selected = useMemo(
    () => users.find((user) => user.id === selectedId) ?? null,
    [users, selectedId],
  );

  function saveUser(user: MessagingUser) {
    const next = users.map((row) => (row.id === user.id ? user : row));
    setUsers(next);
    onUsers(next);
    setSelectedId(user.id);
    setLoadError(null);
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-[var(--background)]/92">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Owner
            </p>
            <h1 className="text-lg font-semibold tracking-tight">Teammate texts</h1>
          </div>
          <Link
            href="/"
            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            Back to Dina
          </Link>
        </div>
        <nav className="mx-auto flex max-w-3xl gap-2 px-4 pb-3 sm:px-6">
          <ScreenLink href="/admin/messages" active={screen === "send"}>
            Send a text
          </ScreenLink>
          <ScreenLink href="/admin/messages/phone" active={screen === "phone"}>
            Phone and consent
          </ScreenLink>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {loadError && (
          <p className="mb-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {loadError}
          </p>
        )}
        {screen === "send" ? (
          <SendScreen users={users} />
        ) : (
          <PhoneScreen
            users={users}
            selected={selected}
            onSelect={setSelectedId}
            onSaved={saveUser}
          />
        )}
      </main>
    </div>
  );
}

function MessagesFrame({
  screen,
  children,
}: {
  screen: "send" | "phone";
  children: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-[var(--background)]/92">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Owner
            </p>
            <h1 className="text-lg font-semibold tracking-tight">Teammate texts</h1>
          </div>
        </div>
        <nav className="mx-auto flex max-w-3xl gap-2 px-4 pb-3 sm:px-6">
          <ScreenLink href="/admin/messages" active={screen === "send"}>
            Send a text
          </ScreenLink>
          <ScreenLink href="/admin/messages/phone" active={screen === "phone"}>
            Phone and consent
          </ScreenLink>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 text-sm text-[var(--muted)] sm:px-6">
        {children}
      </main>
    </div>
  );
}

function ScreenLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white dark:text-[#102019]"
          : "rounded-full px-3 py-1.5 text-sm text-[var(--muted)] hover:bg-[var(--surface)]"
      }
    >
      {children}
    </Link>
  );
}

function SendScreen({ users }: { users: MessagingUser[] }) {
  const [userId, setUserId] = useState(users.find((user) => user.canSend)?.id ?? users[0]?.id ?? "");
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<"rcs_first" | "sms_only">("rcs_first");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const selected = users.find((user) => user.id === userId) ?? null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: selected.id, text, channel }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        messageId?: string;
        channel?: string;
      };
      if (!response.ok || !data.ok) {
        setNotice({ tone: "err", text: data.error ?? "The text was not sent." });
        return;
      }
      setText("");
      setNotice({
        tone: "ok",
        text: `Sent as ${data.channel === "rcs" ? "RCS" : data.channel === "sms" ? "SMS" : data.channel}.`,
      });
    } catch {
      setNotice({ tone: "err", text: "The text was not sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Send a text</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pick a teammate who has a mobile number and recorded SMS consent.
          Opted-out numbers are blocked until they reply START.
        </p>
      </div>

      <label className="block text-sm font-medium">
        Teammate
        <select
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {users.length === 0 && <option value="">No users</option>}
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.username}) ·{" "}
              {user.phoneNumber ? `${user.phoneNumber} · ${statusLabel(user)}` : "No number"}
            </option>
          ))}
        </select>
      </label>

      {selected?.blockMessage && (
        <p className="rounded-xl border border-[var(--status-warn)]/40 bg-[var(--status-warn)]/10 px-3 py-2 text-sm">
          {selected.blockMessage}
        </p>
      )}

      <label className="block text-sm font-medium">
        Message
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          maxLength={2000}
          required
          placeholder="Write the text to send"
          className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Channel</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="channel"
            value="rcs_first"
            checked={channel === "rcs_first"}
            onChange={() => setChannel("rcs_first")}
            className="mt-1"
          />
          <span>
            <span className="font-medium">RCS first</span>
            <span className="mt-0.5 block text-[var(--muted)]">
              Send as RCS. This does not fall back to SMS.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="channel"
            value="sms_only"
            checked={channel === "sms_only"}
            onChange={() => setChannel("sms_only")}
            className="mt-1"
          />
          <span>
            <span className="font-medium">SMS only</span>
            <span className="mt-0.5 block text-[var(--muted)]">
              Send from the campaign number. Carrier registration must be active.
            </span>
          </span>
        </label>
      </fieldset>

      {notice && (
        <p
          className={
            notice.tone === "ok"
              ? "rounded-xl border border-[var(--status-ok)]/30 bg-[var(--status-ok)]/10 px-3 py-2 text-sm"
              : "rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
          }
        >
          {notice.text}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !selected || !text.trim() || !selected.canSend}
        className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
      >
        {busy ? "Sending…" : "Send text"}
      </button>
    </form>
  );
}

function PhoneScreen({
  users,
  selected,
  onSelect,
  onSaved,
}: {
  users: MessagingUser[];
  selected: MessagingUser | null;
  onSelect: (id: string) => void;
  onSaved: (user: MessagingUser) => void;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Phone and consent</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Numbers are stored in E.164. Consent records who saved it, when, and how.
        </p>
        <ul className="mt-4 space-y-1">
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onSelect(user.id)}
                className={
                  user.id === selected?.id
                    ? "w-full rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-left text-sm"
                    : "w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--surface)]"
                }
              >
                <span className="block font-medium">{user.name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {user.phoneNumber
                    ? `${user.phoneNumber} · ${statusLabel(user)}`
                    : "No number"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <PhoneForm key={selected.id} user={selected} onSaved={onSaved} />
      ) : (
        <p className="text-sm text-[var(--muted)]">No users to edit.</p>
      )}
    </div>
  );
}

function PhoneForm({
  user,
  onSaved,
}: {
  user: MessagingUser;
  onSaved: (user: MessagingUser) => void;
}) {
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber ?? "");
  const [consent, setConsent] = useState(Boolean(user.smsConsentAt));
  const [consentMethod, setConsentMethod] = useState(user.smsConsentMethod ?? "verbal");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/messages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          phoneNumber: phoneNumber.trim() ? phoneNumber.trim() : null,
          consent,
          consentMethod: consent ? consentMethod : null,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        user?: MessagingUser;
      };
      if (!response.ok || !data.ok || !data.user) {
        setNotice({ tone: "err", text: data.error ?? "Could not save." });
        return;
      }
      onSaved(data.user);
      setPhoneNumber(data.user.phoneNumber ?? "");
      setConsent(Boolean(data.user.smsConsentAt));
      setConsentMethod(data.user.smsConsentMethod ?? "verbal");
      setNotice({ tone: "ok", text: "Saved phone and consent." });
    } catch {
      setNotice({ tone: "err", text: "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  return (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <div>
            <h3 className="text-base font-semibold">{user.name}</h3>
            <p className="text-sm text-[var(--muted)]">@{user.username}</p>
          </div>

          <label className="block text-sm font-medium">
            Mobile number
            <input
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+14352382071"
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-[var(--muted)]">
            Use E.164, like +14352382071. Leave blank to remove the number.
          </p>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            SMS consent is on file
          </label>

          {consent && (
            <label className="block text-sm font-medium">
              How consent was recorded
              <select
                value={consentMethod}
                onChange={(event) => setConsentMethod(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                {CONSENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <dl className="space-y-1 text-sm text-[var(--muted)]">
            <div>
              <dt className="inline">Recorded by </dt>
              <dd className="inline text-[var(--foreground)]">
                {user.smsConsentBy?.name ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="inline">When </dt>
              <dd className="inline text-[var(--foreground)]">
                {user.smsConsentAt ? `${formatWhen(user.smsConsentAt)} MT` : "—"}
              </dd>
            </div>
            <div>
              <dt className="inline">How </dt>
              <dd className="inline text-[var(--foreground)]">
                {user.smsConsentMethod ? methodLabel(user.smsConsentMethod) : "—"}
              </dd>
            </div>
            {user.smsOptedOutAt && (
              <div className="text-[var(--danger)]">
                Opted out {formatWhen(user.smsOptedOutAt)} MT. A START reply clears this.
                Changing the number also clears it.
              </div>
            )}
          </dl>

          {notice && (
            <p
              className={
                notice.tone === "ok"
                  ? "rounded-xl border border-[var(--status-ok)]/30 bg-[var(--status-ok)]/10 px-3 py-2 text-sm"
                  : "rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
              }
            >
              {notice.text}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#102019]"
          >
            {busy ? "Saving…" : "Save phone and consent"}
          </button>
        </form>
  );
}
