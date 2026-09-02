## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.
> Also: for full same-machine history use `claude -c` in Claude Code, `pi -c` under pi, or `agy -c` under agy.

`/save` is the **lightweight, frequent checkpoint** for a long autonomous run —
a fan-out orchestration, a `/queue` drain, an overnight loop. It refreshes the
committed handoff, commits whatever has converged, and pushes, so an abrupt
rate-limit or crash loses **at most one step**.

It writes the same `.pause/handoff.md` that `/resume` reads, so a cold or
post-reset session picks up with no re-derivation.

**Three checkpoint skills, one handoff file:**

- **`/save`** — *this skill.* Fire it **often and automatically** — after every
  lane merge, at each meaningful step, and when nearing the usage limit. Low
  ceremony, high frequency.
- **`/pause`** — the **deliberate one-shot handoff** you write when stepping
  away: richer prose, open questions, the full "where it stands."
- **`/resume`** — the **reader**. Pulls and continues from whatever `/save` or
  `/pause` last wrote.

## When it matters

A long run can be cut off mid-stride — a rolling usage-window limit, a crash, a
dropped connection. Whatever was not **pushed** is invisible to the session that
picks up. `/save` shrinks that loss to a single step by checkpointing
continuously instead of once at the end.

Nothing here assumes a code project — the work in flight may be Markdown, a
`docs/<slug>/` feature folder, or a decision log, and it is handled the same way.

## Steps

### 1 — Refresh the handoff

Overwrite `.pause/handoff.md` — one file, always "latest"; git history keeps the
prior checkpoints. Keep it terse and act-ready:

- **When / branch** — timestamp and current branch.
- **Goal** — the one-line objective.
- **Exact next action** — the precise command(s) to run next, written so a cold
  reader acts without guessing. This section is what makes pickup instant.
- **In-flight state** — which subagent / worktree holds which task (agent id),
  any lane whose push was rejected and still has to land, and the serial-resource
  cursor (e.g. which GPU or queue item is mid-flight).
- **Pending decisions** — anything awaiting the user.

No secrets, keys, or tokens — this gets pushed.

### 2 — Commit what converged

- Stage the work that has actually converged **by explicit path**, together with
  the handoff, and commit: `git commit -m "save: <one-line goal> (checkpoint)"`.
  In a repo carrying untracked build or forge intermediates, never `git add -A` —
  name the specific paths so nothing junk rides along.
- Nothing converged since the last save? Commit just the refreshed handoff.

### 3 — Push immediately

- `git push` (or `git push origin HEAD:<branch>` from a worktree lane). Push the
  moment a unit converges — a checkpoint that stays local does not survive the
  machine going away.
- No upstream? Set one (`git push -u origin <branch>`); without a push, pickup
  cannot work.

### 4 — Near the usage limit: schedule past the reset

When the rolling usage window is **close to its limit** (or on an explicit
rate-limit signal), do not burn the remainder:

1. Run steps 1–3 now so the checkpoint is current and pushed.
2. **Drop a memory pointer** — a short project-memory note pointing at
   `.pause/handoff.md` (or the run's dedicated resume doc), so a compacted or
   cold session finds it with no conversation history.
3. **`ScheduleWakeup` for after the window resets**, then stop. Spend the budget,
   sleep, auto-resume — never retry-storm the limit. On wake, hand off to
   `/resume`.

## Critical rules

1. **Frequent beats final.** Fire `/save` on every lane merge and at each
   meaningful step — not once at the end. A checkpoint one step stale survives a
   rate-limit; a checkpoint written only at shutdown does not.
2. **Pushed or stranded.** Pickup sees only pushed commits — push each unit the
   moment it converges.
3. **Explicit paths, no junk.** Stage converged work by path; never `git add -A`
   in a repo carrying build or forge intermediates.
4. **One handoff, overwritten.** `.pause/handoff.md` is always current; history
   keeps the rest. It is the same file `/pause` writes and `/resume` reads.
5. **Near the limit: refresh, point, sleep.** Checkpoint, drop the memory
   pointer, `ScheduleWakeup` past the reset — do not spend the last of the budget
   racing the wall.
