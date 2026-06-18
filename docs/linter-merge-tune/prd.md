# PRD: linter-merge-tune

## Problem Statement

`/add-linter` today is binary: a language is either freshly configured with
scaffold's opinionated template, or — if a foreign config already exists — the
tool drops a `<config>.scaffold-new` sidecar and leaves the user to diff and
merge by hand. Two gaps follow:

1. **No merge.** Adopting scaffold thresholds on a repo that already has a linter
   config means manual reconciliation. Most users won't do it.
2. **No tuning.** Scaffold's defaults are opinionated and there is no low-friction
   way to adapt them to a project's preferences — the user must hand-edit the
   config and risk fighting it on the next run.

A third latent problem: once a config carries the scaffold marker it is **frozen**
— future scaffold threshold updates never reach it, with no signal.

## Solution

Extend the **`add-linter` skill** with two agent-driven steps and make two
**minimal, deterministic** changes to the tools. The skill performs all semantic
work (diffing, merging, tuning); the tools stay pure Node with no LLM dependency,
preserving scaffold's harness/LLM-agnostic property.

- **Merge step (foreign + stale):** the tool emits the sidecar; the agent reads the
  foreign config and the sidecar, proposes a merged config as a diff (user rules
  kept, scaffold thresholds added, conflicts flagged with user's value winning),
  and writes it on approval — preserving the original as `<config>.bak`.
- **Tune step (always offered):** after any config is written, the agent scans the
  repo's code, suggests preference-matched rule values, and applies confirmed edits
  as a diff.
- **Staleness:** the marker records a hash of the template it was merged from;
  `detect.mjs` reports `stale` when the current template hash differs, so the skill
  can offer a re-merge. Self-maintaining, no manual version bumps.

## User Stories

1. As a user with an existing `eslint.config.mjs`, when I run `/add-linter`, the
   agent proposes a merged config that keeps my rules and adds scaffold thresholds,
   shown as a diff I approve before anything is written.
2. As that user, my original config is preserved as `eslint.config.mjs.bak` until I
   confirm, so the merge is reversible.
3. As a user whose config disables a rule scaffold enforces, the merge keeps my
   setting and lists the conflict explicitly so I can opt into scaffold's value.
4. As a user adding a linter to an existing codebase, after the config is written
   the agent offers to tune rules and suggests values matching my code (e.g. it
   sees ~120-col lines and proposes `max-len: 120`).
5. As a user, I can decline tuning and keep scaffold's opinionated defaults.
6. As a user, I can describe preferences in plain language ("complexity as a
   warning, not an error") and the agent edits the config and shows the diff.
7. As a maintainer who updated a scaffold template, every consumer's marked config
   reports `stale` on next detect and is offered a re-merge that preserves their
   customizations.
8. As a user with a merged config, `/sync-scaffold` never overwrites it (it is not
   in the sync manifest) and re-running `/add-linter` skips it unless it is `stale`.
9. As a user of a format-only language (zig/mojo), behavior is unchanged — there is
   no config to merge or tune.
10. As a shell user, the merge preserves my `.shellcheckrc` directives and tuning
    lets me enable/disable specific checks.
11. As a user who declines the merge, the `.scaffold-new` sidecar is left in place,
    my original is untouched, and I can re-run later.

## Implementation Decisions

### Tools (deterministic — `tools/linter-setup/`)
- **`emit.mjs`** — when writing a scaffold-managed config, stamp the marker with
  the template content hash: `<marker> sha256:<hash12>` (first 12 hex chars of
  sha256 over the template file's UTF-8 bytes, via `node:crypto`). Sidecar/backup
  emission for the foreign path remains; no merge logic enters the tool.
- **`detect.mjs`** — extend `state` resolution to `{ none, foreign, scaffold,
  stale }`. For a marked config, compute the current template hash and compare to
  the stamped hash: equal → `scaffold`, differ → `stale`. If the template is
  unreachable, fall back to `scaffold` (never falsely `stale`).
- **Marker parsing** — read the stamped hash from an existing config's marker line;
  tolerate the legacy markerless-of-hash form (treat as `scaffold`, current).

### Skill (`skills/add-linter.md` — agent-driven)
- **Merge step** for `foreign` and `stale` languages: read config + sidecar, build
  a proposed merge (user rules kept; scaffold thresholds added; conflicts flagged,
  user value retained), present as a diff, write on approval, preserve `.bak`.
- **Tune step** offered after every written config: scan code, suggest matching
  values, apply confirmed edits as a diff. Declinable.
- **`stale` handling** in detect partitioning: offer a re-merge.
- Update Step 4 reporting and Step 2 prompts to reflect merge/tune outcomes.

### Contracts
- `detect()` → `{ language, state }[]`, `state ∈ { none, foreign, scaffold, stale }`.
- Marker: `scaffold-linter: <lang> sha256:<hash12>`.
- Hash: `sha256` of template UTF-8 bytes, truncated to 12 hex chars.
- Backup: `<config>.bak`; never overwrite an existing `.bak`.

## Testing Decisions

Deterministic tool changes are unit-tested (the merge/tune reasoning is the
agent's and is not unit-tested):

- **`emit` hash stamping** — emitted marker contains `sha256:<hash12>` matching the
  template hash; idempotent re-emit of a current config still skips.
- **`detect` staleness** — `scaffold` when stamped == current; `stale` when stamped
  ≠ current (simulate a template edit); `scaffold` fallback when template
  unreachable; `foreign` when marker absent; `none` when file absent.
- **Marker parsing** — extract stamped hash; legacy marker without hash → treated
  as current `scaffold`.
- **Backup safety** — existing `.bak` not overwritten (skill-level concern noted;
  enforce in tool only if emit owns backup writing).
- **Integration** — existing scenarios still pass; add a `stale`-detection scenario
  end to end.
- **Bash assertions** — every template's marker still present and parseable.

Prior art: `tools/linter-setup/test`, `test-integration`,
`scripts/test-linter-setup.sh`.

## Out of Scope

- Per-language structured-ruleset parsers (`--emit-ruleset`) — rejected (D6).
- Two-layer `extends`/import config split — rejected (D2 alternative).
- Calling an LLM from any tool — violates the agnostic constraint.
- New languages or changes to which linters are used.
- Auto-applying tune/merge without approval.

## Further Notes

- The merge/tune reasoning lives entirely in the skill prompt; any capable coding
  agent running `/add-linter` performs it. No API key, no SDK, no new dependency.
- `node:crypto` is the first crypto use in committed tools; stdlib, zero deps.
- Staleness needs the template reachable (true in the npx / `--scaffold-root` sync
  flow); graceful degradation otherwise.
