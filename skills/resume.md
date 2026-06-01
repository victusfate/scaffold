## Purpose

Pick up a checkpointed session from `.pause/handoff.md` and keep going — whether
you are back on your laptop or coming in cold from Claude mobile/web. Pulls the
latest, reconstructs where things stood, and continues from the handoff's next
steps. No assumption of a code project: the in-flight work may be plain Markdown.

Counterpart to `/pause`, which produces the handoff this reads.

## Steps

### 1 — Get the latest

- `git pull` (set the upstream first if the branch has none).
- If `claude -c` is available on *this* machine, mention it: full conversation
  history beats a reconstructed handoff. Use this skill when that history is
  gone, or when you are on a different device.

### 2 — Read the checkpoint

- Open `.pause/handoff.md`. If it is missing, say so and offer to scan the
  recent git log instead.
- Follow its pointers and open what it names:
  - a `docs/<slug>/` feature folder — read `design.md`, `prd.md`, `plan.md`,
    `tdd-log.md` to locate the current phase or slice;
  - any specific Markdown files it flags as mid-edit (`context/`, a decision
    log, working notes);
  - project memory under the session's memory directory, if one is present.

### 3 — Reconstruct and confirm

- Summarize back in a few lines: goal, what is done, where the cursor sits, and
  the first next step. This is the proof the handoff loaded correctly.
- Flag anything stale — a named file that no longer exists, or a step already
  completed.

### 4 — Continue

- Start the first item under the handoff's "Next steps." Do not ask the user to
  re-explain what the handoff already records.

## Critical rules

1. **Work cold.** Assume zero prior conversation — a fresh phone or cloud
   session. Everything needed must come from pushed files, never the memory of a
   chat.
2. **Verify before acting.** A handoff reflects the moment it was written; check
   that the files and steps it names still hold before charging ahead.
3. **Reconstruct, do not interrogate.** Read the artifacts yourself; only ask
   the user when the handoff is genuinely ambiguous or missing.
