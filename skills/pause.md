## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.
> Also: `claude -c` (Claude Code session resume) is `pi -c` in pi. For agy, use `agy -c`.

Checkpoint the current working session into git so it survives a close and can
be picked up from anywhere — your laptop or Claude mobile/web. Writes a
human-readable handoff, commits whatever is in flight (code *or* prose — docs,
notes, decision logs), and pushes so a cold session elsewhere can resume.

Pairs with `/resume`, which reads what this writes.

## When it matters

The only state another device sees is what you have **pushed**. `claude -c`
reopens this exact conversation with full history, but only on *this* machine.
`/pause` exists for the gap that leaves:

- **Cross-device** — a phone or cloud session can't `--continue` your local
  chat; it reads the committed handoff instead.
- **A durable written record** you or a teammate can read later.

Nothing here assumes a code project. The work in flight may be Markdown —
`docs/`, `context/`, a `decisions/` log — and it is handled the same way.

## Steps

### 1 — Write the handoff

Overwrite `.pause/handoff.md` (one file, always "latest" — git history keeps the
rest). Keep it tight and high-signal:

- **When / branch** — timestamp and current branch.
- **Goal** — the one-line objective.
- **Active artifacts** — the files being worked on, each with a one-line "where
  it stands." Name them explicitly: a `docs/<slug>/` feature folder and which
  phase or slice it is on, or the specific Markdown files mid-edit.
- **Done this session** — three to six bullets of what changed.
- **Next steps** — concrete, with exact commands. The most important section:
  write it so a cold reader acts without guessing.
- **Open questions** — anything unresolved.
- **How to resume** — point at `/resume`; note `claude -c` is richer on this
  machine.

No secrets, keys, or tokens — this gets pushed.

### 2 — Commit everything in flight

- Run `git status`. **Surface every uncommitted path to the user** — anything
  left out will not travel to another device.
- Stage and commit the work plus the handoff together:
  `git add -A && git commit -m "pause: <one-line goal> (handoff)"`.
- If the tree was already clean, commit just the handoff.

### 3 — Push

- `git push` to the upstream so the handoff is reachable elsewhere.
- No upstream? Say so plainly and offer to set one
  (`git push -u origin <branch>`) — without a push, cross-device resume cannot
  work.

### 4 — Report

State, in two lines: what was committed and pushed, and how to come back —
`/resume` from any device, or `claude -c` here for full history.

## Incremental mode

`/pause` is not only for stepping away — it is also the **checkpoint primitive
for a long autonomous run** (a fan-out orchestration, a `/queue` drain, an
overnight loop). Instead of firing once at the end, fire it **repeatedly** so an
abrupt rate-limit or crash loses **at most one step**:

- **On every lane merge.** The moment a subagent / worktree lane merges into the
  one working branch, run the Steps again — refresh the handoff and push. The
  checkpoint then always reflects the last *integrated* unit; nothing that has
  converged is left stranded in a local session.
- **Periodically** through a long solo stretch — at each meaningful step (a
  slice committed, a queue task drained), never only at shutdown.

Each firing runs the same Steps (write handoff → commit in flight → push); only
the cadence differs. Because `.pause/handoff.md` is one overwritten file,
refreshing it is cheap, and git history keeps every prior checkpoint. This
incremental firing pairs directly with the fan-out / orchestration workflow —
checkpoint on each lane merge is how a many-lane run stays resumable.

### Rate-limit / usage-window trigger

When the rolling usage window is **near its limit** (or on an explicit
rate-limit signal), do not burn the remainder blindly:

1. **Refresh the handoff now.** Record the *exact* next action and commands, the
   in-flight lane / worktree state (which agent id holds which task, any
   push-rejected lane still to land), and any pending user decisions — so a cold
   or post-reset session continues without re-deriving anything.
2. **Drop a memory pointer.** Leave a short project-memory note pointing at
   `.pause/handoff.md` (or the run's dedicated resume doc), so a compacted or
   cold session finds the checkpoint even with no conversation history.
3. **Schedule the resume past the reset.** `ScheduleWakeup` for *after* the
   window resets, then stop — spend the budget, sleep, auto-resume. Never
   retry-storm into the limit. On wake, hand off to `/resume`, which reads the
   handoff this wrote.

The durable resume doc a long orchestration maintains (a committed, always-latest
state file the wakeup reads first) is exactly what this trigger keeps fresh.

## Critical rules

1. **Pushed or stranded.** Cross-device resume only sees pushed commits. Always
   flag dirty paths before they are lost.
2. **No secrets in the handoff.** Prose and pointers, not credentials.
3. **`claude -c` (or `pi -c`) wins on the same machine** — recommend it when the user is just
   stepping away locally; do not oversell the skill.
4. **One handoff, overwritten.** `.pause/handoff.md` is always current.
5. **Incremental beats final.** In a long autonomous run, checkpoint on every
   lane merge and at each meaningful step — not once at the end. A handoff one
   step stale survives a rate-limit; a handoff written only at shutdown does not.
   Near the usage limit, refresh, drop the memory pointer, schedule past the
   reset, then stop — do not spend the last of the budget racing the wall.
