# Slack ↔ Piper (Regi only)

Piper already talks to 4StudentLives teammates over Telnyx RCS. This Slack bot is a **second ingress**, hard-scoped to the **Regi** project. It does not write 4SL or MetabolicOS tasks.

Live Piper: https://dina.clifsmama.com

## What it does

1. Slack `app_mention` (and thread follow-ups) arrive via **Socket Mode** (preferred) or HTTP Events
2. Map Slack user → Piper member (`User.slackUserId` or `SLACK_USER_MAP`)
3. Unknown users get a thread reply: ask Derek to add them
4. Known Regi members: create or update a **Regi** project task + Attention item
5. Same Grok Bot Dina handoff used by Telnyx (`GROK_BOT_DINA_WEBHOOK_URL`)
6. Piper replies in the **same Slack thread**

Telnyx `/api/telnyx/webhook` is unchanged.

## Why Socket Mode

HTTP Event Subscriptions can verify (`url_verification`) while Cloud Run never sees `event_callback` / `app_mention` POSTs. Slack Socket Mode opens a long-lived WebSocket from Piper to Slack and is the **preferred** inbound path.

When Socket Mode is **enabled** in the Slack app, Slack delivers events **only** over that WebSocket — not to the Request URL. That can look like “URL verifies, @Piper is a real APP mention, but nothing hits `/api/slack/events`.”

HTTP `/api/slack/events` stays up for:

- Slack `url_verification` if you keep a Request URL
- Fallback `event_callback` if Socket Mode is toggled off

Both paths call the same pipeline: `parseSlackInboundEvent` → `processSlackInbound` → roster / ledger / Grok Bot / in-thread reply.

## Create the Slack app

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch.
2. Install it only in the **Regi** workspace.
3. **OAuth & Permissions** → Bot Token Scopes:
   - `chat:write` — reply in threads
   - `app_mentions:read` — `@Piper` mentions
   - `channels:history` — public-channel thread follow-ups
   - `groups:history` — private-channel thread follow-ups (if you use them)
   - `im:history` — only if you set `SLACK_REGI_ALLOW_IMS=true`
   - `im:write` — only for DMs
4. Install to workspace → copy **Bot User OAuth Token** (`xoxb-…`) → `SLACK_BOT_TOKEN`.
5. **Basic Information** → **Signing Secret** → `SLACK_SIGNING_SECRET`.
6. Optional: copy the bot’s member ID (`U…`) → `SLACK_BOT_USER_ID` so Piper ignores itself.

## Socket Mode setup (preferred)

1. Slack app → **Socket Mode** → **Enable Socket Mode**.
2. Create an **App-Level Token** (`xapp-…`) with scope `connections:write` (Basic Information → App-Level Tokens). Set `SLACK_APP_TOKEN`.
3. **Event Subscriptions** → subscribe to the same bot events (Request URL is optional once Socket Mode is on):
   - `app_mention`
   - `message.channels`
   - `message.groups` (private channels)
   - `message.im` only if DMs are enabled
4. You may leave Request URL as `https://dina.clifsmama.com/api/slack/events` so URL verification still works if you toggle Socket Mode off later. Do not rely on it for `app_mention` while Socket Mode is on.
5. Invite the bot to the Regi channel(s): `/invite @Piper`.
6. Restart Dina (`npm start` / Cloud Run revision) so `instrumentation.ts` opens the socket.
7. Confirm `GET /api/slack/events` shows `inbound: "socket"` and `socketMode.connected: true`.

## How the socket stays open

Dina already runs a long-lived Node server (`next dev` / `next start`). The least-invasive approach is to start `@slack/socket-mode` **inside that process** from `instrumentation.ts` (`register()`), which Next.js calls once when the Node server boots.

`npm run slack:socket` is the same client as a dedicated worker (see Cloud Run below).

`SLACK_SOCKET_MODE`:

| Value | Behavior |
|---|---|
| unset / `in-process` | Start from Next.js instrumentation (default) |
| `standalone` / `worker` | Do **not** start in Next.js; only `npm run slack:socket` |
| `off` / `http` | Never start Socket Mode (HTTP Events only) |

## Cloud Run

The WebSocket dies if the container has no CPU or scales to zero.

On the Cloud Run service that runs `next start`:

1. **Minimum instances = 1** so the process (and socket) stay up.
2. **CPU always allocated.** Default Cloud Run only schedules CPU during HTTP requests; the socket would freeze between hits.
   - `gcloud run services update SERVICE --no-cpu-throttling`
   - or newer flag `--cpu-idle=false` / console “CPU is always allocated”
3. Prefer **one instance** (or a small max) for the service that holds the socket. Slack allows at most **10** Socket Mode connections per app; each instance opens one. Events are load-balanced across connections — do not assume sticky delivery.
4. Request timeout / ingress settings do not apply to Socket Mode events.

Optional split (web can scale independently):

- Web service: `SLACK_SOCKET_MODE=standalone` (no socket)
- Second Cloud Run service: `npm run slack:socket`, same env (`DATABASE_URL`, Slack tokens, Grok Bot webhook), min instances 1, CPU always allocated

A sidecar/process manager is not required for the default in-process path.

## Piper env

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
SLACK_APP_TOKEN=xapp-…          # Socket Mode (connections:write)
# SLACK_SOCKET_MODE=in-process  # default; standalone | off
SLACK_REGI_PROJECT_SLUG=regi
# Optional allowlist (C… / G…). Empty = any channel the bot is in.
SLACK_REGI_CHANNEL_IDS=C0123ABCD
SLACK_REGI_ALLOW_IMS=false
SLACK_BOT_USER_ID=U0BOT
# Until User.slackUserId is set:
SLACK_USER_MAP=U012ABC:adam,U034DEF:derek
```

`SLACK_REGI_PROJECT_SLUG` must resolve to **regi**. Values that resolve to `4studentlives` or `metabolicos` are rejected.

## Map Slack users to Piper

```bash
USERNAME=adam SLACK_USER_ID=U012ABCDEF npm run user:link-slack
```

Or when adding a teammate:

```bash
NAME="Alex" USERNAME="alex" TEMP_PASSWORD="temporary-password" \
  PROJECTS="regi" SLACK_USER_ID="U012ABCDEF" npm run user:add
```

Unknown Slack accounts are **not** auto-provisioned. They get a clear thread reply to ask Derek.

## Grok Bot

Inbound Slack uses the same webhook as Telnyx. Extra fields:

- `channel: "slack"`
- `messageType: "slack"`
- `projectKeys: ["regi"]` only
- `slack: { teamId, channelId, threadTs, eventTs, slackUserId }`

If Grok Bot returns `{ ok: true, reply: { text } }`, that text is posted in-thread. If the webhook is unset, Piper still writes the Regi task/Attention and posts a local ack.

Async Slack send (service token): `POST /api/grok/outbound-slack` with `{ channelId, threadTs, text }`.

## Smoke checks

```bash
# Config (no Slack secrets required)
curl -sS https://dina.clifsmama.com/api/slack/events
# { ok, service: "slack-events", configured, inbound: "socket"|"http",
#   socketMode: { configured, started, connected }, projectKey: "regi", scope: "regi" }

curl -sS https://dina.clifsmama.com/api/health
# checks.slack = configured | missing
# checks.slackSocket = connected | started | configured | missing | error
# checks.telnyx must still work independently
```

Watch Cloud Run / `next start` logs for `slack_socket_started` and `slack_socket_connected`.

Local (after setting `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` + `SLACK_APP_TOKEN`):

1. Enable Socket Mode in the Slack app and generate `xapp-…` with `connections:write`.
2. `npm run dev` — confirm `slack_socket_connected` in logs (or `npm run slack:socket` with `SLACK_SOCKET_MODE=standalone`).
3. Mention the bot in a Regi channel as a **mapped** user → task appears on Regi, reply lands in-thread.
4. Mention the bot as an **unmapped** user → “ask Derek to add you”.
5. Optional: keep Request URL pointed at `/api/slack/events` and confirm URL verification still succeeds.
6. Send a Telnyx RCS to Piper (4SL) → still replies via Telnyx; no Slack writes.

Automated:

```bash
npx vitest run tests/slack-*.test.ts tests/telnyx-*.test.ts tests/health.test.ts
```
