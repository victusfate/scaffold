## Purpose

Add linter configs and GitHub Actions workflows for languages detected in the
current repo. One prompt per language — the user decides which to adopt.

## When invoked

- Explicitly by the user (`/add-linter`)
- After `/sync-scaffold` emits the "hint: languages detected without scaffold
  linter config" message

## Step 1 — detect languages

Run detect-only against the current repo (`.`):

```bash
node tools/linter-setup/run --detect-only --into .
```

Parse the JSON array `[{ language, state }]`. `state` is one of `none`, `foreign`,
`scaffold`, or `stale`.

Partition results:
- `state: "scaffold"` → current scaffold config; skip silently
- `state: "none"` → no linter config found; offer a **fresh add**
- `state: "foreign"` → config exists but lacks the scaffold marker; offer a **merge**
- `state: "stale"` → scaffold config whose template has since changed; offer a
  **re-merge** (pull the updated thresholds, keep the user's customizations)

If all languages are `"scaffold"` (or no languages detected), report:
> All detected languages already have scaffold linter configuration. Nothing to do.

and stop.

## Step 2 — prompt once per actionable language

For each language with state `none`, `foreign`, or `stale`, ask the user exactly
once. Ask as a group (one `AskUserQuestion` call) with multi-select, not one-by-one.

Present each language as an option:
- **state `none`**: "Add [Linter] for [language]? (config + workflow)"
  - description: "Writes [configFile] and .github/workflows/[workflowFile]"
- **state `foreign`**: "Merge scaffold thresholds into your [language] config?"
  - description: "Proposes a merge of [configFile] (your rules kept + scaffold
    thresholds added); you approve a diff before anything is written"
- **state `stale`**: "Re-merge updated scaffold thresholds for [language]?"
  - description: "Scaffold's template changed since you adopted it; proposes a diff
    that layers the new thresholds onto your current [configFile]"

Allow multi-select so the user can confirm all, some, or none.

If the user confirms none, stop without writing anything.

## Step 3 — emit confirmed languages

Pass the confirmed language list as JSON to the linter-setup CLI:

```bash
echo '["js","python"]' | node tools/linter-setup/run --into .
```

Use `--scaffold-root` if needed for non-standard paths. The CLI is deterministic:
- `none` → writes the config (marker hash-stamped) + workflow
- `foreign`/`stale` → writes the template to `[configFile].scaffold-new` (sidecar);
  the existing config is left untouched
- `scaffold` → skipped

When a config is **adopted** (written fresh, or already current), the CLI also
adds the linter's npm packages to the repo's `package.json` `devDependencies`
(idempotently — only names missing from both `dependencies` and
`devDependencies`; existing versions are never changed), so the starter runs
locally. A `sidecar` (foreign/stale) does **not** inject deps — the consumer
hasn't adopted the config yet (add them when you apply the merge in Step 4). If
there's no `package.json`, the CLI reports the `npm i -D …` one-liner instead of
creating one. Remind the user to run `npm install` after deps are added.

## Step 4 — merge step (state `foreign` and `stale` only)

The CLI never edits an existing config; the **merge is yours to perform**. For each
language that produced a sidecar:

1. Read the existing `[configFile]` and the `[configFile].scaffold-new` sidecar.
2. Build a proposed merged config:
   - keep every rule the user already set,
   - add scaffold thresholds the user lacks,
   - on a **direct conflict** (user value vs. scaffold value, or user-disabled vs.
     scaffold-enforced) **keep the user's value** and record the conflict.
   - carry the scaffold marker line from the sidecar (it holds the `sha256:` stamp)
     into the merged config so future detection reports `scaffold`, not `stale`.
3. Present the proposal as a diff against the existing config, with a conflict list:
   ```
   CONFLICT max-len:    you=120, scaffold=100  -> kept 120
   CONFLICT no-console: you=off, scaffold=error -> kept off
   ```
4. On approval: back up the original to `[configFile].bak` (do **not** overwrite an
   existing `.bak` — if one exists, surface it and ask), write the merged config to
   `[configFile]`, and remove the `.scaffold-new` sidecar.
5. If the user declines: leave the sidecar and original in place; nothing is marked.

## Step 5 — tune step (offered after every written/merged config)

For each language whose config was written (fresh add) or merged, offer an optional
tuning pass — this is how the user adapts opinionated defaults without fighting them:

1. Scan the repo's existing code for that language and propose preference-matched
   values (e.g. observed line length, indentation, common complexity ceilings).
   Phrase as a concrete suggestion, not a blank prompt:
   > Your code already uses ~120-col lines. Set `max-len: 120`? Any other tweaks?
2. The user confirms, overrides in plain language, or declines.
3. Apply confirmed edits to `[configFile]`, show the diff, write on approval.
4. Declining keeps scaffold's defaults. Tuning never changes the marker stamp
   (staleness tracks the template, not the user's tuned values).

## Step 6 — report results

For each language processed, report:

| Result | Message |
|--------|---------|
| `written` | "✓ [lang]: wrote [files]" |
| `deps` | "✓ [lang]: added [packages] to package.json devDependencies — run `npm install`" |
| `merged` | "✓ [lang]: merged into [file] (original kept as [file].bak)" |
| `tuned` | "✓ [lang]: applied [N] preference edits" |
| `skipped` | "— [lang]: already current (skipped)" |
| `declined` | "— [lang]: left unchanged" |

## Step 7 — commit prompt

Ask: "Commit the added linter files? (y/n)"

If yes:
```bash
git add .
git commit -m "feat: add scaffold linter config for [languages]"
```

If no, remind the user the files are staged and ready to commit manually.

## Notes

- **Format-only languages** (zig, mojo): no config file, workflow only — there is
  nothing to merge or tune. Present as "Add [zig fmt / mojo format] workflow?" and
  skip Steps 4–5 for them.
- **Shell**: Shellcheck is correctness-only — no rubric thresholds. It still
  participates in merge/tune (preserve the user's directives; tuning
  enables/disables specific checks).
- **Merge and tune are agent-driven, not tool features.** The CLI only detects,
  emits, hash-stamps, and writes sidecars (all deterministic); the diff/merge/tune
  reasoning is performed by whoever runs this skill. No LLM dependency is added to
  the tools — scaffold stays harness/LLM-agnostic.
- **Backups and sidecars are local artifacts.** Do not commit `[configFile].bak` or
  `[configFile].scaffold-new`; they exist only to make a merge reversible. Remove
  the sidecar after a merge; leave `.bak` until the user is satisfied.
- The `tools/linter-setup/run` CLI handles all clobber-safe logic; this skill
  drives the user interaction and the semantic merge/tune layer.
- If `tools/linter-setup/run` is not available (consumer repo without scaffold
  tools), fall back to reading the language templates directly from
  `lib/linters/<lang>/` and copying them manually.
