# Dina

Private, mobile-first AI chief-of-staff chat app. Runs locally on a Mac mini, reachable via ngrok, installable as a PWA, with streaming OpenAI responses and Web Push.

## Requirements

- Node.js 20+ (Node 22 recommended)
- npm
- An OpenAI API key
- Optional: ngrok for remote access from iPhone

## Quick start

```bash
npm install
npm run setup
```

Edit `.env` (created from `.env.example` by setup):

```bash
ACCESS_CODE=your-private-code
SESSION_SECRET=at-least-32-characters-of-random-string
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
APP_URL=http://localhost:8080
DATABASE_URL="file:../data/dina.db"
```

Generate Web Push keys and paste them into `.env`:

```bash
npm run generate-vapid
```

Start development (binds to **0.0.0.0:8080**):

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ACCESS_CODE` | yes | Temporary login code (never put in the URL) |
| `SESSION_SECRET` | yes | Cookie signing secret (32+ chars) |
| `OPENAI_API_KEY` | yes | Server-only OpenAI key |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o` |
| `APP_URL` | yes | Absolute public URL (`http://localhost:8080` or your ngrok HTTPS URL) |
| `DATABASE_URL` | yes | Prisma SQLite URL, e.g. `file:../data/dina.db` |
| `VAPID_PUBLIC_KEY` | for push | From `npm run generate-vapid` |
| `VAPID_PRIVATE_KEY` | for push | From `npm run generate-vapid` |
| `VAPID_SUBJECT` | for push | `mailto:you@example.com` |
| `HOST` / `PORT` | no | Documented as `0.0.0.0` / `8080` (scripts already bind this) |
| `MS_TENANT_ID` | for M365 | Entra tenant ID (same app as `mcp-servers`) |
| `MS_CLIENT_ID` | for M365 | Entra app (client) ID |
| `MS_CLIENT_SECRET` | for M365 | App client secret (`.env` only — never commit) |
| `MS_USER_EMAIL` | for M365 | Mailbox / user UPN for app-only calls |
| `MS_SHAREPOINT_SITE` | no | Graph site path, e.g. `contoso.sharepoint.com:/sites/Site` |
| `MS_SHAREPOINT_DEFAULT_FOLDER` | no | Default folder for notes |

## Microsoft 365

Dina reuses the same **app-only client credentials** pattern as `/Users/derekfowler/mcp-servers` (client credentials → Graph `/.default` → `/users/{MS_USER_EMAIL}/...`).

When configured, chat can call tools for:

- Outlook mail (list/read/mark/send/reply draft/folders)
- Calendar (list/create/update/delete)
- Contacts
- OneDrive (list/search)
- SharePoint notes + folder listing
- Planner (plans/buckets/tasks)
- Microsoft To Do
- Teams (joined teams / channels / channel messages — best effort; needs app permissions)

Put secrets only in `.env`. If the client secret previously lived in Python source, rotate it in Entra when you can.

### Suggested Entra application permissions

Grant **application** permissions with admin consent as needed:

- `Mail.ReadWrite`, `Mail.Send`
- `MailboxSettings.ReadWrite` (inbox rules)
- `Calendars.ReadWrite`
- `Contacts.Read`
- `Files.ReadWrite.All`
- `Sites.ReadWrite.All`
- `Tasks.ReadWrite.All` (Planner)
- `Group.Read.All` (often required for Planner plan discovery)
- `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Send` (Teams; may still be limited for app-only)
- `User.Read.All` (resolve user profile for health check)

If a tool fails with 403, Dina will surface the Graph error — add the missing permission and re-consent.

## Database

SQLite file lives in `data/dina.db` (created by setup / Prisma).

```bash
npm run setup          # dirs + migrate/push + icons
npx prisma migrate dev # during schema changes
npx prisma studio      # optional browser UI
```

Uploads are stored in `data/uploads/` (outside `public/`) and served only through authenticated `/api/attachments/[id]`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run setup` | Create data dirs, icons, apply DB schema |
| `npm run generate-vapid` | Print VAPID keys for `.env` |
| `npm run generate-icons` | Regenerate PNG app icons |
| `npm run dev` | Dev server on `0.0.0.0:8080` |
| `npm run build` | Production build |
| `npm run start` | Production server on `0.0.0.0:8080` |
| `npm test` | Vitest suite |

## ngrok

1. Start Dina: `npm run dev` (or production `npm run build && npm run start`).
2. Start your existing tunnel to port 8080, e.g. `ngrok http 8080`.
3. Set `APP_URL` to the HTTPS ngrok URL (no trailing slash) and restart Dina so secure cookies / absolute URLs match.
4. Open the ngrok URL on your iPhone.

Do not hard-code the ngrok hostname in the app. When the tunnel URL changes, update `APP_URL`.

## PWA install

### iPhone

1. Open the HTTPS URL (ngrok or local network) in Safari.
2. Share → **Add to Home Screen**.
3. Open Dina from the Home Screen (standalone).

### Mac

1. Open the app in Chrome or Edge.
2. Use the install / “Add to Dock” control from the address bar / app menu.
3. Launch the installed PWA.

## Web Push

1. Configure VAPID keys in `.env`.
2. Open the installed PWA (or browser tab) over HTTPS (required except localhost).
3. Tap **Enable notifications** (permission is requested only then).
4. Tap **Test push** (desktop header), or `POST /api/push/test` while authenticated.
5. Close the app, confirm the notification arrives, tap it to return to the conversation.

Example payload:

- Title: `Dina`
- Body: `This is a test notification.`

Multiple devices are supported (unique push endpoints stored in SQLite). Expired subscriptions are removed on delivery failure.

## Production on a Mac mini (launchd)

1. Build once:

```bash
npm run build
```

2. Copy [`deploy/com.dina.app.plist`](deploy/com.dina.app.plist), replace `REPLACE_ME` paths, and ensure `npm` path matches your machine (`which npm`).

3. Create log directory:

```bash
mkdir -p ~/Library/Logs/dina
```

4. Install and load (only when you are ready):

```bash
cp deploy/com.dina.app.plist ~/Library/LaunchAgents/com.dina.app.plist
launchctl load ~/Library/LaunchAgents/com.dina.app.plist
```

Unload:

```bash
launchctl unload ~/Library/LaunchAgents/com.dina.app.plist
```

This starts Dina after reboot, restarts on crash, and writes logs under `~/Library/Logs/dina/`.

## Manual verification checklist

- [ ] Login with access code
- [ ] Text chat streams in real time
- [ ] Image upload + question about the image
- [ ] PDF / Markdown / text upload
- [ ] Conversation persists after refresh
- [ ] Mobile layout + keyboard safe areas
- [ ] PWA install (iPhone + Mac)
- [ ] Enable notifications → test push while closed → tap returns to chat
- [ ] Reachable through ngrok HTTPS
- [ ] `GET /api/health` returns ok

## Limitations (v1)

- Single continuous conversation (single-user)
- Access-code auth only (no Google OAuth yet)
- No long-term memory system
- Microsoft 365 uses app-only credentials (not delegated user OAuth); some Teams APIs may still 403 depending on tenant permissions
- Gmail / Apple Notes / Apple Reminders not integrated
- Office documents (`.docx`, `.xlsx`, etc.) are rejected — use PDF, images, or text/Markdown
- HEIC may depend on browser/OS decoding for preview; OpenAI vision support varies by model

## Architecture notes

- OpenAI access goes through `lib/ai/provider.ts` so Claude or another provider can be added later without rewriting the chat UI.
- Microsoft Graph tools live in `lib/microsoft/` and are registered into the Responses API tool loop when `MS_*` env vars are set.
- Extension stubs remain in `lib/extensions/` for non-Microsoft providers.
- Prisma + SQLite today; switch `DATABASE_URL` / provider for PostgreSQL later without changing route shapes.

## Troubleshooting

| Problem | Fix |
|---|---|
| Redirect loop / can’t log in | Ensure `SESSION_SECRET` is 32+ chars and `APP_URL` matches how you open the app (`http` vs `https`) |
| Cookies fail behind ngrok | Set `APP_URL` to the HTTPS ngrok URL and restart |
| OpenAI errors in UI | Check `OPENAI_API_KEY`, model name, and network; see server JSON logs |
| DB errors | Run `npm run setup` / `npx prisma db push`; ensure `data/` is writable |
| Push doesn’t work | HTTPS required (or localhost); VAPID keys set; permission granted; PWA/service worker registered |
| Upload rejected | Stay within size limits; use image/PDF/text — not Office files |
| Port in use | Stop the other process on 8080 or change the `-p` flag in scripts |
| `microsoft: error` in health | Check `MS_*` env vars, client secret validity, and Entra admin consent for app permissions |
| Tool returns 403 | Missing Graph application permission — grant + admin consent, then retry |

## Tests

```bash
npm test
```

Covers access-code verification, login success/failure/lockout, health, message persistence helpers, push subscription storage, file validation, and a chat provider error path.
