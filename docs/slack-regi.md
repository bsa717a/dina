# Slack ↔ Piper (Regi only)

Piper already talks to 4StudentLives teammates over Telnyx RCS. This Slack bot is a **second ingress**, hard-scoped to the **Regi** project. It does not write 4SL or MetabolicOS tasks.

Live Piper: https://dina.clifsmama.com

## What it does

1. Slack `app_mention` (and thread follow-ups) → verify signature
2. Map Slack user → Piper member (`User.slackUserId` or `SLACK_USER_MAP`)
3. Unknown users get a thread reply: ask Derek to add them
4. Known Regi members: create or update a **Regi** project task + Attention item
5. Same Grok Bot Dina handoff used by Telnyx (`GROK_BOT_DINA_WEBHOOK_URL` + `GROK_BOT_DINA_WEBHOOK_SECRET`)
6. Piper replies in the **same Slack thread**

Telnyx `/api/telnyx/webhook` is unchanged.

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

## Event Subscriptions

Request URL:

```
https://dina.clifsmama.com/api/slack/events
```

Subscribe to bot events:

- `app_mention`
- `message.channels`
- `message.groups` (private channels)
- `message.im` only if DMs are enabled

Slack will POST a `url_verification` challenge. Piper echoes `{ "challenge": "…" }` after signature check. Event callbacks return 200 immediately (work runs after the response) so Slack does not retry a slow Grok handoff. The same channel+ts is processed once — Slack's paired `app_mention` + `message` events share that key.

Invite the bot to the Regi channel(s): `/invite @Piper`.

## Piper env

```bash
SLACK_BOT_TOKEN=xoxb-…
SLACK_SIGNING_SECRET=…
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

Inbound Slack uses the same webhook as Telnyx. Set `GROK_BOT_DINA_WEBHOOK_SECRET` to the Routines panel **sender key** (`crsr_…`). Piper sends it as `Authorization: Bearer <key>` and `X-Automation-Key` — HMAC-only headers will not wake the routine.

Extra fields:

- `channel: "slack"`
- `messageType: "slack"`
- `projectKeys: ["regi"]` only
- `slack: { teamId, channelId, threadTs, eventTs, slackUserId }`

If Grok Bot returns `{ ok: true, reply: { text } }`, that text is posted in-thread. If the webhook accepts the handoff without a sync reply (`status: sent`, no `reply.text`), Piper stays silent — Dina’s Old Dina routine later POSTs the real answer via `/api/grok/outbound-slack`. If the webhook is unset (`logged`) or the handoff errors, Piper still writes the Regi task/Attention and posts a local ledger ack.

Async Slack send (service token): `POST /api/grok/outbound-slack` with `{ channelId, threadTs, text }`.

## Smoke checks

```bash
# Config (no Slack secrets required)
curl -sS https://dina.clifsmama.com/api/slack/events
# { ok, service: "slack-events", configured, projectKey: "regi", scope: "regi" }

curl -sS https://dina.clifsmama.com/api/health
# checks.slack = configured | missing
# checks.telnyx must still work independently
```

Local (after setting `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET`):

1. `npm run dev` and point Slack Request URL at your ngrok `APP_URL` + `/api/slack/events`.
2. Confirm Slack URL verification succeeds.
3. Mention the bot in a Regi channel as a **mapped** user → task appears on Regi, reply lands in-thread.
4. Mention the bot as an **unmapped** user → “ask Derek to add you”.
5. Send a Telnyx RCS to Piper (4SL) → still replies via Telnyx; no Slack writes.
