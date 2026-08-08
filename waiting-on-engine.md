# Waiting On Engine

The Waiting On Engine is a core capability of Dina.

Its purpose is to ensure that nothing important falls through the cracks.

The engine should continuously discover, track, and update commitments without requiring Derek to manually manage a task list.

## Goal

Maintain two dynamic lists:

### Waiting On Derek

Things requiring action from Derek.

Examples:

* Reply to an email.
* Review a pull request.
* Approve a draft.
* Make a decision.
* Respond to a meeting request.
* Review completed AI agent work.

### Waiting On Others

Things Derek is expecting from someone else.

Examples:

* Customer promised a response.
* GitHub pull request awaiting review.
* Vendor quote.
* School district feedback.
* AI coding agent still running.
* Someone said "I'll get back to you."

For v1, AI agents and technical processes fold into **Waiting On Others**, with `person` / `source` identifying the agent. The lists should update automatically.

The purpose is not task management.

The purpose is confidence that nothing important has been forgotten.

---

## Ownership vs Attention, Memory, and Projects

Waiting On must not become a second Attention system or a duplicate of Memory.

| Surface | Role |
|---|---|
| **Waiting On Engine** | Durable ledger of open commitments (both directions) |
| **Attention** | Interrupt queue for items that need Derek *now* |
| **Memory `commitments`** | Long-lived facts / context, not the live list |
| **ProjectTask ledger** | Live per-project backlog of work items (not external waits) |
| **Project docs** | Summary fields (“Waiting on Derek / others”), fed *from* the engine |
| **Daily Briefing §4** | Consumes the waiting lists; does not invent a separate format |

Rules:

* Attention cards may *point at* a waiting item; they are not the waiting item.
* A waiting item can exist for days without creating an Attention card.
* Only interrupt-worthy waits promote into Attention (`notifyNow` / Needs Your Attention).
* Memory may store durable commitment facts; the live open/closed state lives in the waiting ledger.
* Project “Waiting on Derek / Waiting on others” fields are summaries derived from the ledger, not a parallel source of truth.
* **ProjectTask ≠ Waiting On.** ProjectTask is “work I plan to do on Dina / 4SL / …”. Waiting On is “I am blocked on a reply, PR review, or someone else’s action.” Never store numbered project backlogs as Waiting items or Memory commitment blobs.
* Do not invent a separate briefing format — feed [Daily Briefing section 4](dina-operating-manual.md).

Without this ownership, the same PR or email will be triple-counted across Attention, Memory, and Waiting.

---

## Architecture

Stay inside the existing pipeline. Do not put Graph/GitHub calls inside a separate Waiting On service.

```
Connectors (M365, GitHub, Chat)
  → NormalizedEvent
  → Chief of Staff decide
  → WaitingItem ledger (+ optional AttentionItem)
  → Daily Briefing §4 + chat query tool
```

* Connectors emit evidence; the Chief of Staff decides disposition and waiting flags.
* Apply path upserts durable `WaitingItem` records.
* Chat answers waiting questions via a query tool over the ledger.
* Briefing assembly reads active / suggested-follow-up items.

Align naming with existing CoS analysis flags: `someoneWaitingOnDerek` / `derekWaitingOnSomeone`.

---

## Sources

### v1 (required)

Use connected systems that can open *and* resolve items:

* Microsoft 365 — inbound mail **and sent / thread state**
* GitHub — PR review requests, assignments, merges/closes, workflows
* Conversation history — explicit promises and reminders (lower confidence)
* Memory — seed / enrich from `commitments` (not the live list)

**Hard dependency:** v1 requires sent-mail / conversation-thread awareness in the Microsoft connector. Without it, Waiting On Others is mostly guesswork from inbound mail alone.

| Source | Waiting On Derek | Waiting On Others | Notes |
|---|---|---|---|
| M365 inbound mail | Strong | Weak | Partial today (unread → CoS) |
| M365 sent / thread state | Weak | Strong | **Required for v1 Others** |
| GitHub PR review / assignment | Strong | Strong | Events exist; need durable wait lifecycle |
| Conversation history | Medium | Medium | Not scanned by CoS today |
| Memory commitments | Seed / enrich | Seed / enrich | Category exists |
| AI agents | — | Medium | Fold into Others; emit real events when available |

### Future

* Gmail
* Calendar
* Teams
* SharePoint
* Apple Notes
* Apple Reminders

Do not design the v1 model around future sources.

---

## Automatic Discovery

Discover in confidence tiers so the Definition of Done is achievable.

### Tier 1 — Structured / high confidence

Open or update `active` items from clear system evidence:

* Pull request requesting Derek’s review → Waiting On Derek
* Issue or PR assigned to another developer (Derek expecting progress) → Waiting On Others
* Unread mail clearly asking Derek to act → Waiting On Derek
* Open AI agent run → Waiting On Others
* Derek sent mail clearly awaiting a reply (thread state) → Waiting On Others

### Tier 2 — Thread / commitment inference

Infer from language when evidence is strong enough; otherwise `needs_confirmation`:

* Email: "I'll send that tomorrow." → Waiting On Others
* Email: "Can you review this?" → Waiting On Derek
* Email / thread: "I'll get back to you." → Waiting On Others

### Tier 3 — Conversation mining

* Conversation: "Derek, remind me to finish this Friday." → Waiting On Derek (`needs_confirmation` when timing/scope is ambiguous)

LLM extraction of soft commitments should create `needs_confirmation` items when confidence is low. Ask rather than guess. Do not aim for perfect NLP on day one.

---

## Waiting Item Model

Each item should contain:

* **ID**
* **Direction** — `waiting_on_derek` | `waiting_on_others`
* **Title**
* **Description**
* **Project** (optional `projectKey`)
* **Person** — who is owed / who owes (agents allowed for Others)
* **Source** — system origin (`microsoft365`, `github`, `conversation`, `memory`, `agent`, …)
* **Evidence** — source refs + short quote/reason (email id, PR URL, chat message id, confidence rationale)
* **Created**
* **Last Activity** — real thread / PR / agent activity
* **Last Evaluated At** — last stale / intelligence reevaluation (distinct from Last Activity)
* **Due Date** (optional)
* **Priority** — `critical` | `high` | `normal` | `low` (same as CoS / Attention)
* **Status** — see below
* **Confidence**
* **Recommended Next Action**
* **Resolved At** (optional)
* **Resolution Reason** (optional) — `reply_received` | `pr_merged` | `pr_reviewed` | `issue_closed` | `agent_finished` | `derek_handled` | `dismissed` | `stale_cancelled` | `user_confirmed`

### Status values

* `active` — confirmed open wait
* `needs_confirmation` — inferred but uncertain; ask Derek
* `suggested_follow_up` — stale enough to recommend action; still not auto-notified for age alone
* `resolved` — closed with a resolution reason
* `cancelled` — explicitly dropped / no longer relevant

Do not use ambiguous statuses like “Open” vs “Waiting,” or “Blocked” (direction already encodes waiting on someone else).

---

## Lifecycle

### Open

Open when there is clear evidence of an unmet commitment or request (Tier 1), or when Tier 2/3 inference is confirmed / high-confidence enough for `active` or `needs_confirmation`.

### Update

Update when there is new activity on the same email thread, PR, issue, or agent run. Refresh Last Activity, evidence, priority, and recommended next action. Do not create a duplicate item for the same underlying source identity.

### Resolve

Resolve when:

* A reply was received that fulfills the wait
* A PR was reviewed / merged (as appropriate to the wait)
* An issue closed
* An agent finished and the outcome was reviewed or acknowledged
* Derek handled it another way
* Derek confirms done or soft-cancels

**Do not resolve solely because time passed.**

### Cancel

Cancel when Derek dismisses as irrelevant, or after explicit confirmation that a stale item should be dropped (`stale_cancelled` / `user_confirmed`).

### Idempotency and reopen

* Same email conversation / PR / issue / agent run maps to one waiting item (stable source identity).
* New evidence updates that item.
* A dismissed Attention card must **not** block reopening or updating the waiting item when new evidence appears.
* Waiting lifecycle is independent of Attention status (`open` / `dismissed` / `resolved`).

---

## Intelligence

The Waiting On Engine should continuously ask:

* Has someone replied?
* Has the work completed?
* Has a workflow finished?
* Did Derek already handle this another way?
* Has this become stale?
* Has the priority changed?
* Should I follow up?

Reevaluation writes **Last Evaluated At**. Only real external activity writes **Last Activity**.

---

## Stale Detection

If an item has had no activity, reevaluate at checkpoints:

* 3 days
* 7 days
* 14 days
* 30 days

These are **reevaluation checkpoints**, not notification triggers.

Flow:

1. Checkpoint reached → reevaluate
2. Optionally upgrade status to `suggested_follow_up`
3. Optionally include in Daily Briefing §4
4. **Never push solely because time passed**

When reevaluating, consider:

* Relationship
* Priority
* Project importance
* Original expectation
* Whether a due date existed

Cap follow-up suggestions per briefing (top 3–5 meaningful items). Quiet by default.

---

## Follow-up Recommendations

When appropriate suggest:

"We've been waiting on Breck for six days."

"I recommend following up."

Provide a draft follow-up message.

**Never send automatically.** Draft-before-send authority applies.

---

## Product Surfaces (v1)

1. **Chat query tool** over the waiting ledger — answer “What am I waiting on?” and related questions from live records (not improvisation from inbox tools alone).
2. **Daily Briefing §4 — Waiting On** — include only meaningful waiting items.
3. **Optional Attention promotion** — interrupt-worthy waits only.

**No full task-list CRUD UI in v1.** Manual create should be rare. Confirm, dismiss, and resolve via chat is enough.

### Daily Briefing example

Waiting On Derek

* Review Beacon PR
* Reply to Justin

Waiting On Others

* Breck — County workflow feedback
* Adam — Funding decision
* Cursor — Beacon implementation

### Conversation

Support questions like:

* "What am I waiting on?"
* "Who is waiting on me?"
* "What is blocked?"
* "What have I forgotten?"
* "What should I follow up on?"
* "What projects are stalled?"

Answers must read from the waiting ledger (plus live tools only to enrich, not replace, the ledger).

---

## Chief of Staff Behavior

The Waiting On Engine should quietly maintain awareness.

Derek should rarely need to create tasks manually.

The system should infer commitments from evidence.

When uncertain, ask rather than guess (`needs_confirmation`).

Prefer high-confidence structured discovery first; expand soft inference only where resolution signals exist.

---

## Definition of Done

Observable outcomes for v1:

* Dual lists exist as durable records (`waiting_on_derek` / `waiting_on_others`), updated by the scan / apply loop.
* High-confidence GitHub and mail cases (including sent / thread state for Others) open, update, and resolve without Derek creating tasks.
* Soft inferences land as `needs_confirmation` when unsure.
* Briefing §4 and chat (via ledger query tool) can answer the six example questions from the live ledger.
* Follow-up recommendations include a draft and never send.
* Quiet by default; stale age alone never pushes.
* Attention, Memory, and Waiting do not triple-count the same evidence — ownership rules above hold.

Dina can accurately maintain dynamic Waiting On Derek and Waiting On Others lists using evidence from connected systems, recommend follow-ups, draft follow-up messages, and surface only the items that genuinely deserve Derek’s attention.
