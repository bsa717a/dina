# Writing Assistant

The Writing Assistant is a core capability of Dina.

Its purpose is to write in Derek’s voice across every medium — so drafts sound like Derek wrote them, not like a generic assistant.

Example: “Draft an email to Adam about the funding follow-up.”

## Goal

Produce drafts that are:

- concise, confident, warm, direct, practical
- adapted to the audience (executive, customer, church, family, peer)
- suited to the medium (email, Teams, GitHub review note)
- aligned with learned preferences (e.g. one clear ask, not five options)

Always draft first. Send or post only with Derek’s approval.

## Ownership

| Surface | Role |
|---|---|
| **Writing Assistant** | Assembles voice + drafts text for a medium/audience |
| **Operating Manual § Writing Style** | Canonical voice rules |
| **Learning Engine / Memory** | Evolving prefs (`learned_preferences`, `communication_style`) |
| **Microsoft / GitHub tools** | Place or send drafts after approval |
| **Attention revise / CoS drafts** | Must use the same voice pack |

## Voice pack

One shared pack for chat drafts, CoS `draftBody`, and Attention revise:

1. Writing Style bullets from the Operating Manual
2. Active communication / learned-preference memories
3. Optional recipient context (role, relationship)

Do not maintain parallel “voice” strings in each caller.

## Mediums (v1)

| Medium | Output | Placement after approval |
|---|---|---|
| `email` | subject + body | `create_reply_draft` or `send_email` |
| `teams` | message body | Teams tools when available; otherwise copy |
| `github_review` | short review/decision note | Paste / PR comment tooling later |

## Chat tool

`draft_in_dereks_voice`

Inputs: `medium`, `purpose`, optional `to` / person, `points`, `audience`, `toneHint`  
Output: `{ medium, audience, subject?, body }` — never sends.

When Derek asks to write, draft, or reply, call this tool (or revise an Attention draft) before inventing prose from scratch.

## Definition of Done (v1)

1. “Draft an email to Adam about X” → sounds like Derek, one clear ask, not sent.
2. Same voice pack used by CoS drafts and Attention revise.
3. “Send it” / “put it in Outlook” uses existing Graph tools after approval.
4. Writing Assistant project task marked done.
