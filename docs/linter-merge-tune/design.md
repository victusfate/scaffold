# Design — linter-merge-tune

Extend the `add-linter` skill with two agent-driven steps: (1) merge a foreign
linter config with the scaffold template, and (2) let the user tune the rules to
project preferences. **The skill does the reasoning; the tools stay deterministic.**

## Guiding constraint

Scaffold is LLM/harness-agnostic. Tools (`detect.mjs`, `emit.mjs`, `run`) remain
pure Node — no LLM, no deps, no API key. All semantic work (diffing, merging,
tuning) lives in the `add-linter` **skill** prompt and is performed by whatever
agent runs the skill. Determinism stays in the tool layer; judgment stays in the
agent layer.

## Canonical vocabulary

| Term | Meaning |
|------|---------|
| **foreign config** | An existing linter config in the repo with no scaffold marker. |
| **scaffold template** | The canonical config under `lib/linters/<lang>/`, carrying rubric thresholds + marker. |
| **sidecar** | `<config>.scaffold-new` — deterministic copy of the template emitted next to a foreign config. |
| **merge** | Agent-produced single config combining the user's foreign rules with scaffold thresholds. |
| **tune / customization step** | Interactive agent step that adapts rule severities/values to the project's stated preferences. |
| **marker** | `scaffold-linter: <lang>` comment that flags a config as scaffold-managed (drives `state` detection). |
| **backup** | `<config>.bak` — the original foreign config, preserved until the user confirms the merge. |

## Decisions

### D1 — Foreign-config merge output: propose diff, write on approval
The deterministic tool still emits the `.scaffold-new` sidecar. The agent then:
1. reads the foreign config + the sidecar,
2. presents a **proposed merged config as a diff** (user's rules kept + scaffold thresholds added),
3. writes the merged config to the real config path **only after the user approves**,
4. preserves the original as `<config>.bak`.

**Rationale:** keeps a reversible checkpoint at the cheap moment; no silent overwrite.
**Alternatives rejected:** auto-merge in place (no approval gate, less reversible);
annotate-sidecar-only (leaves the manual diffing burden the feature is meant to remove).

### D2 — Staleness via hash-stamped marker (versioned marker, option b)
A merged/tuned config is consumer-owned: it is **not** in `scaffold-files.txt`, so
`/sync-scaffold` never overwrites it, and the marker makes re-running `/add-linter`
idempotent (`emit` skips marked configs). The risk that remains is **freeze** — a
marked config never picks up updated scaffold thresholds. Resolve it with a
content-hash stamped into the marker (self-maintaining; no hand-bumped version).

Marker format gains a hash of the **pristine scaffold template** at merge time:
```
# scaffold-linter: python sha256:a1b2c3d4e5f6
```
`detect.mjs` recomputes the current template hash and compares:

| Config file | Marker | Hash | state |
|---|---|---|---|
| absent | — | — | `none` |
| present | none | — | `foreign` |
| present | yes | stamped == current | `scaffold` |
| present | yes | stamped ≠ current | `stale` |

- `foreign` → first merge (D1 flow).
- `stale` → skill offers a **re-merge**: base = existing merged config, incoming =
  new template; user customizations preserved, new thresholds layered on approval.
- Hashing is `node:crypto` (stdlib, zero deps) — stays in the deterministic tool
  layer. Precedent: read-once content-hash.
- **Graceful degradation:** if the template is unreachable (detect can't compute the
  current hash), marked configs report `scaffold`/current, never falsely `stale`.

**Rationale:** self-maintaining (no manual version bumps), makes the freeze visible,
and the merge step we are already building *is* the re-merge mechanism.
**Alternatives rejected:** accept-the-freeze / opt-in `--refresh` (silent drift);
two-layer `extends` config (cleaner long-term but breaks on linters without
`extends`/import support — clippy, shellcheck — and is a larger change).

### D3 — Tune step: always offered, auto-suggested from a code scan
After **any** config is written (fresh add, foreign merge, or stale re-merge) the
agent offers an optional tuning pass. It first **scans the repo's existing code**
and proposes values that match what it finds (e.g. observed line length, common
patterns), so the user starts from a concrete suggestion rather than a blank
prompt. The user confirms, overrides in plain language, or declines. The agent
edits the config and shows a diff; writes only on approval. Declining keeps
scaffold's opinionated defaults.

**Rationale:** lowest-friction path to *"adapt rules without fighting the config"*;
the code scan makes the first suggestion useful instead of generic.
**Alternatives rejected:** prompt-only with no suggestions (blank-prompt friction);
tune-only-on-foreign-merge (fresh adds are exactly where opinionated defaults most
often need softening for an existing codebase).

**Note:** tuning diverges the config from the template, but the marker hash stamps
the **template** hash (D2), so tuning never affects staleness detection. On a stale
re-merge the agent reads the current (tuned) config and preserves those tweaks.

### D4 — Merge conflicts: user wins, every conflict flagged
When a foreign rule directly contradicts a scaffold threshold (different value, or
user-disabled vs. scaffold-enforced), the **user's value is kept** — their setting
is deliberate. Each conflict is listed explicitly in the merge diff summary:
```
CONFLICT max-len:    you=120, scaffold=100  -> kept 120
CONFLICT no-console: you=off, scaffold=error -> kept off
```
Non-conflicting scaffold thresholds are added. The user can flip any flagged
conflict toward scaffold's value during the tune step (D3).

**Rationale:** aligns with *"don't fight the config"* — never silently override the
user; surface divergence so adopting scaffold's stricter value is a visible opt-in.
**Alternatives rejected:** scaffold-wins (overrides deliberate user intent);
ask-per-conflict (prompt storm on configs with many conflicts — tuning already
gives per-rule control without blocking the merge).

### D5 — Scope: all 7 config-bearing languages; format-only unchanged
Merge + tune apply to every language with a config file: js, python, go, rust,
ruby, elixir (rubric thresholds) **and shell** (merge preserves user shellcheck
directives; tune enables/disables checks). zig and mojo are format-only with no
config file — they keep the existing fresh-add behavior (workflow only); there is
nothing to merge or tune.

**Rationale:** mergeability is determined by config-file presence, which the
registry already encodes (`configFile` set vs. absent). Shell has a config, so it
participates even without rubric thresholds.

### D6 — Determinism boundary: agent reads both files; tools change minimally
The merge reasoning is the agent's. The tool already emits the sidecar (= the
pristine template) next to the foreign config, so the agent reads both and merges
directly. The **only** deterministic tool changes are:
1. `emit.mjs` — stamp the template content hash into the marker it writes (D2).
2. `detect.mjs` — compute the current template hash and return `stale` when the
   stamped hash differs (D2).

No per-language config parsers are added — the agent reads config syntax it
already understands; brittle parsers (eslint flat JS, ruff toml, yaml, ...) stay
out of the deterministic layer.

**Rationale:** maximal determinism with minimal tool surface; keeps the 7-language
maintenance burden in pre-authored templates, not in parsing code.
**Alternative rejected:** `--emit-ruleset` structured-JSON helper (7 brittle
parsers in the layer we are deliberately keeping deterministic).

## Edge cases

- **No foreign config (`none`)** — fresh add as today; tune step still offered (D3).
- **`stale` config** — offer re-merge (base = current tuned config, incoming = new
  template); user customizations + flagged conflicts preserved.
- **Template unreachable** — detect cannot hash the current template → report
  `scaffold`/current, never falsely `stale` (D2 graceful degradation).
- **Merge declined** — leave the `.scaffold-new` sidecar in place; original
  untouched; nothing marked. Re-runnable later.
- **Tune declined** — keep opinionated defaults; config already written/marked.
- **format-only langs (zig/mojo)** — no config; merge/tune skipped entirely (D5).
- **Backup collision** — if `<config>.bak` already exists, do not overwrite a prior
  backup; the agent surfaces this rather than clobbering.

## Q&A summary

| # | Question | Decision |
|---|----------|----------|
| 1 | Foreign-merge output | Propose diff → write on approval → keep `.bak` (D1) |
| 2 | When/how to tune | Always offer + auto-suggest from code scan (D3) |
| — | Effect on future pulls | Sync-safe (not in manifest); hash marker → `stale` re-merge (D2) |
| 3 | Merge conflicts | User wins; flag every conflict; flippable in tune (D4) |
| 4 | Language scope | All 7 config-bearing incl. shell; zig/mojo unchanged (D5) |
| 5 | Determinism boundary | Agent reads both files; tools only hash-stamp + `stale` (D6) |
