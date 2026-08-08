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
OPENAI_MODEL=gpt-4.1-mini
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
| `OPENAI_MODEL` | no | Defaults to `gpt-4.1-mini` |
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

- Outlook mail (list/read/mark/send/drafts/attachments/folders/rules)
- Calendar (list/create/update/delete/accept-decline)
- Contacts
- OneDrive (list/search/read/write/folder create/move/copy/delete)
- Office docs on OneDrive (create/read Word, Excel, PowerPoint)
- SharePoint notes + folder listing
- Planner (plans/buckets/tasks/details/delete)
- Microsoft To Do
- Teams channels (list/read/send/reply — not 1:1 chats under app-only auth)

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
- `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send` (Teams channels; 1:1 chats need delegated auth)
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

## GitHub (multi-account)

Dina supports multiple GitHub accounts from day one — separate credentials, allowlists, and audit identity. Permissions and repositories are never mixed across accounts.

Example `.env`:

```bash
GITHUB_ACCOUNTS=personal,4studentlives
GITHUB_PERSONAL_TOKEN=
GITHUB_PERSONAL_OWNER=bsa717a
GITHUB_4STUDENTLIVES_TOKEN=
GITHUB_4STUDENTLIVES_OWNER=4StudentLives
```

With `GITHUB_<ID>_OWNER` set and no allowlist (or `ALLOWED_REPOSITORIES=*`), Dina discovers **all repositories** visible for that owner. To restrict, set `GITHUB_<ID>_ALLOWED_REPOSITORIES=owner/repo-a,owner/repo-b`.

Prefer separate **GitHub App installations** (`GITHUB_<ID>_APP_ID`, `GITHUB_<ID>_INSTALLATION_ID`, `GITHUB_<ID>_APP_PRIVATE_KEY`) when possible; otherwise use fine-grained read-only PATs.

Every repository/event is keyed as `accountId:owner/repo` so the same repo name under different owners cannot collide. Chat tools answer cross-account and account-scoped questions; Attention cards label the GitHub account when relevant. One account’s auth failure does not take down the others.

## Constitution

Foundational documents (loaded into every chat system prompt; runtime wiring must not override them):

- [`constitution.md`](constitution.md) — identity and judgment principles
- [`dina-operating-manual.md`](dina-operating-manual.md) — decision framework, authority, briefing, writing, north star
- [`derek-fowler-profile.md`](derek-fowler-profile.md) — who Derek is
- [`derek-projects.md`](derek-projects.md) — active projects and project philosophy
- [`dina-memory-rules.md`](dina-memory-rules.md) — what becomes memory, confidence, approval, hierarchy
- [`waiting-on-engine.md`](waiting-on-engine.md) — Waiting On Engine: durable dual lists, lifecycle, v1 sources, surfaces
- [`learning-engine.md`](learning-engine.md) — Learning Engine: feedback → lesson → apply via Memory
- [`writing-assistant.md`](writing-assistant.md) — Writing Assistant: Derek’s voice across mediums

Foundational docs are also seeded into the Memory System.

## Memory System

Memory is structured long-term knowledge — **not** the chat transcript. Operating rules live in [`dina-memory-rules.md`](dina-memory-rules.md).

### Domains

Derek Profile · Values · Communication Style · Preferences · Family · Church · Health · People · Projects · Commitments · Decisions · Learned Preferences

### Each memory item

Unique ID, category, title, content, source, confidence (Confirmed / High / Medium / Low), created, last updated, last accessed, importance, related items, status (`active` · `pending_approval` · `archived` · `merged`).

Fields `embeddingStatus`, `embeddingModel`, and `embeddingRef` are reserved so semantic search can be added later without changing the model.

### Approval

Safe people/project/commitment facts may store as `active` automatically. Foundational categories (identity, values, preferences, health, family, etc.) from chat or observation start as `pending_approval` until Derek approves.

### Operations

Create · update · correct (by id) · approve · merge duplicates · archive · retrieve relevant

APIs: `GET/POST /api/memory`, `PATCH /api/memory/:id` (`update` | `archive` | `approve`), `POST /api/memory/retrieve`, `POST /api/memory/merge`.

Chat tools: `search_memory`, `remember`, `correct_memory`, `approve_memory`, `archive_memory`, `merge_memories`, `list_memories`.

## Project Task Ledger

Live per-project backlog in SQLite (`ProjectTask`) — not Memory, not Waiting On.

Chat tools: `list_project_tasks`, `add_project_task`, `complete_project_task`, `update_project_task`.

Use for “remaining tasks for Dina” / “mark 6 complete”. Numbers are 1-based on the filtered remaining list (`open` + `in_progress`).

## Morning Ritual

On-demand personal morning packet — **not** the Operating Manual Daily Briefing (win / attention / calendar / waiting-on).

Say **“Morning brief”** in chat → `generate_morning_brief`. Includes:

- Come, Follow Me deep study for today (persisted 7-day week plan; talks/videos/art spread uniquely across the week)
- Book of Mormon schedule line from [`content/schedules/`](content/schedules/)
- Web-researched markets (date-anchored search + selective fetch; news-mediated levels, not live ticks)
- Journal prompt

Schedules: `content/schedules/cfm_schedule_2026.md`, `content/schedules/bom_schedule_2026.md`. Week plans cache in SQLite (`MorningRitualWeekPlan`).

## Learning Engine

Feedback → lesson → apply. Spec: [`learning-engine.md`](learning-engine.md).

Attention actions (edit / revise + note / dismiss / accept) distill into Memory `learned_preferences` or `decisions`. Active lessons are injected into Chief of Staff decide and Attention revise prompts.

## Writing Assistant

Draft in Derek’s voice. Spec: [`writing-assistant.md`](writing-assistant.md).

Chat tool: `draft_in_dereks_voice` (email / Teams / GitHub review note). Shared voice pack used by CoS drafts and Attention revise. Never sends until Derek approves.

The **Chief of Staff Engine** decides when an event deserves durable memory (`writeMemory`). Temporary debugging and casual chat do not become memory.

## Chief of Staff Engine

Dina’s **Chief of Staff Engine** is the central decision-making layer. It answers one question:

> What should Derek know, and what should he do about it?

It never calls Microsoft 365, GitHub, or future vendor APIs directly. **Connectors** translate each integration into **normalized events** (`NewEmail`, `MeetingInvitation`, `WorkflowFailed`, `PullRequestReadyForReview`, etc.). The engine only consumes those events and produces decisions.

### Dispositions (exactly one per event)

- **Create Attention Card** — interrupt-worthy (explains *why* Dina interrupted)
- **Add to Today’s Briefing**
- **Update Project Context**
- **Store as Context**
- **Ignore**

Each decision also gets priority (Critical / High / Normal / Low), confidence, reasoning summary, and a recommended action when useful.

### Connectors (today)

- Microsoft 365 → mail, calendar/invites, To Do reminders
- GitHub (multi-account) → PRs, issues, workflow results, integration alerts

Adding Gmail, Slack, Apple Reminders, etc. means writing a connector that emits the same normalized events — not changing the engine.

### Home screen

Chat shows **Needs Your Attention** cards from the `create_attention_card` disposition. Drafts support **Review / Edit / Send** — never auto-send. Push notifies only when the engine sets `notifyNow`.

### Waiting On Engine

Durable **Waiting On Derek** / **Waiting On Others** lists are specified in [`waiting-on-engine.md`](waiting-on-engine.md). Ownership: Waiting is the ledger; Attention is the interrupt queue; Memory `commitments` is long-lived context; Daily Briefing §4 consumes the lists. v1 surfaces are chat query + briefing (no task-manager UI). CoS already records waiting flags; the durable ledger and sent-mail/thread discovery are not built yet.

### Run a scan

```bash
npm run attention:scan
```

Or `POST /api/attention/scan` (session or `ATTENTION_SCAN_SECRET`).

### launchd (attention scan schedule)

Scans on local time: **every 15 minutes from 6:00–17:00**, then **hourly from 18:00–05:00** (`StartCalendarInterval` in [`deploy/com.dina.attention.plist`](deploy/com.dina.attention.plist)).

1. Ensure Dina is running (`com.dina.app` or `npm run start`).
2. Confirm the plist paths match this Mac (`which node`, repo path).
3. Load:

```bash
mkdir -p ~/Library/Logs/dina
cp deploy/com.dina.attention.plist ~/Library/LaunchAgents/com.dina.attention.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dina.attention.plist
```

Push only works when the browser/PWA has an active notification subscription. If Apple returns 403, Dina drops the dead subscription — re-enable notifications in the app.

## Production on a Mac mini (launchd)

1. Build once:

```bash
npm run build
```

2. Confirm [`deploy/com.dina.app.plist`](deploy/com.dina.app.plist) paths match this Mac (`which npm`, repo path).

3. Create log directory:

```bash
mkdir -p ~/Library/Logs/dina
```

4. Install and load:

```bash
cp deploy/com.dina.app.plist ~/Library/LaunchAgents/com.dina.app.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dina.app.plist
```

Unload:

```bash
launchctl bootout gui/$(id -u)/com.dina.app
```

This starts Dina after reboot, restarts on crash (`KeepAlive`), and writes logs under `~/Library/Logs/dina/`.

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
- Memory retrieval is keyword-based today (embedding fields reserved for later)
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
