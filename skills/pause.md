## Purpose

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

## Critical rules

1. **Pushed or stranded.** Cross-device resume only sees pushed commits. Always
   flag dirty paths before they are lost.
2. **No secrets in the handoff.** Prose and pointers, not credentials.
3. **`claude -c` wins on the same machine** — recommend it when the user is just
   stepping away locally; do not oversell the skill.
4. **One handoff, overwritten.** `.pause/handoff.md` is always current.
