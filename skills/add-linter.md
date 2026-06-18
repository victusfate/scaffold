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

Parse the JSON array `[{ language, state }]`.

Partition results:
- `state: "scaffold"` → already configured; skip silently
- `state: "none"` → no linter config found; offer to add
- `state: "foreign"` → config exists but lacks scaffold thresholds; offer to adopt

If all languages are `"scaffold"` (or no languages detected), report:
> All detected languages already have scaffold linter configuration. Nothing to do.

and stop.

## Step 2 — prompt once per actionable language

For each language with state `none` or `foreign`, ask the user exactly once.
Ask as a group (one `AskUserQuestion` call) with multi-select, not one-by-one.

Present each language as an option:
- **state `none`**: "Add [Linter] for [language]? (config + workflow)"
  - description: "Writes [configFile] and .github/workflows/[workflowFile]"
- **state `foreign`**: "Adopt scaffold thresholds for [language]? ([linter] found
  without scaffold quality thresholds)"
  - description: "Writes [configFile].scaffold-new alongside your existing
    [configFile] — original untouched"

Allow multi-select so the user can confirm all, some, or none.

If the user confirms none, stop without writing anything.

## Step 3 — emit confirmed languages

Pass the confirmed language list as JSON to the linter-setup CLI:

```bash
echo '["js","python"]' | node tools/linter-setup/run --into .
```

Use `--scaffold-root` if needed for non-standard paths.

## Step 4 — report results

For each language processed, report:

| Result | Message |
|--------|---------|
| `written` | "✓ [lang]: wrote [files]" |
| `sidecar` | "✓ [lang]: wrote [file].scaffold-new (diff it against your [file] and merge)" |
| `skipped` | "— [lang]: already configured (skipped)" |

After the report, if any sidecars were created, remind the user:
> Review `.scaffold-new` sidecars before committing — diff against the original
> and cherry-pick the threshold rules you want to keep.

## Step 5 — commit prompt

Ask: "Commit the added linter files? (y/n)"

If yes:
```bash
git add .
git commit -m "feat: add scaffold linter config for [languages]"
```

If no, remind the user the files are staged and ready to commit manually.

## Notes

- **Format-only languages** (zig, mojo): no config file, workflow only.
  Present as "Add [zig fmt / mojo format] workflow for [language]?"
- **Shell**: Shellcheck is correctness-only — no rubric thresholds in config.
  Present as "Add Shellcheck workflow for shell scripts?"
- The `tools/linter-setup/run` CLI handles all clobber-safe logic; this skill
  only drives the user interaction layer.
- If `tools/linter-setup/run` is not available (consumer repo without scaffold
  tools), fall back to reading the language templates directly from
  `lib/linters/<lang>/` and copying them manually.
