# Learning Engine

The Learning Engine is a core capability of Dina.

Its purpose is to continuously improve judgment from Derek’s decisions and corrections — so the same preference does not need to be restated every week.

Example: after Derek indicates he prefers one recommended option instead of five, later Attention and Chief of Staff recommendations follow that pattern.

## Goal

Turn behavioral feedback into durable **Memory** lessons, then apply those lessons the next time Dina recommends or drafts.

This is not model fine-tuning.
This is not a second task list.
This is a feedback → lesson → apply loop.

## Ownership

| Surface | Role |
|---|---|
| **Learning Engine** | Distills signals into lesson candidates |
| **Memory (`learned_preferences` / `decisions`)** | Durable store for lessons |
| **AttentionAction** | Raw signal log (edit, revise, dismiss, accept, send) |
| **CosDecisionRecord** | Prior recommendation context for distillation |
| **Chief of Staff / Attention revise / Chat** | Consumers that must apply active lessons |

Rules:

* Lessons live in Memory — do not invent a parallel lesson table.
* Style/judgment lessons from silent inference start as `pending_approval`.
* Explicit Derek feedback (revise notes, chat corrections) may activate immediately (`source=derek_feedback` or `correction`).
* Authority to act without asking is **Authority Engine**, not Learning Engine.

## Signals (v1)

| Signal | Source | Typical lesson |
|---|---|---|
| `revise_draft` + note | Attention | Explicit preference / tone / format |
| `edited_draft` | Attention | How Derek rewrites recommendations |
| `dismissed_unimportant` | Attention | What not to interrupt for |
| `accepted_recommendation` / `sent_draft` | Attention | Positive reinforcement (light weight) |
| Chat `remember` / `correct_memory` | Memory tools | Already durable — Learning Engine does not duplicate |

Ignored for v1: bulk “Done for all”, ignored_notification without content, one-off factual typos.

## Distillation

After a qualifying AttentionAction:

1. Load action + attention item (+ CosDecisionRecord when present).
2. Prefer **heuristics** for clear patterns (e.g. “prefer one option”).
3. Otherwise call a small model distill when there is a revise note or meaningful draft edit.
4. If a durable lesson exists, upsert Memory via `createOrCorrectMemory` (dedupe by category+title).
5. Never store credentials, temporary debugging, or single-thread facts.

Lesson shape:

* `category`: `learned_preferences` or `decisions`
* `title`: short stable key (e.g. `Recommendation format`)
* `content`: imperative preference Derek would recognize in six months
* `confidence`: 0–1
* `source`: `derek_feedback` (explicit) or `learning_engine` (inferred)

## Application

Before CoS decide and Attention revise, inject active lessons:

```
LEARNED PREFERENCES (apply unless Derek contradicts):
- Recommendation format: Prefer one recommended option…
```

Chat already retrieves Memory; CoS/revise must also load `learned_preferences` + `decisions` explicitly.

## Surfaces

* Chat: “What have you learned about how I work?” → `list_memories` / search
* Approve pending lessons via existing memory approve flow
* No dedicated Learning UI in v1

## Definition of Done (v1)

1. Derek revises/dismisses/edits with a clear preference signal.
2. A Memory lesson is created (active or pending_approval).
3. The next CoS or revise prompt includes that lesson.
4. Observable behavior changes (e.g. one option, not five).
