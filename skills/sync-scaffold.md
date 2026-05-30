## Instructions

Sync this repo from the upstream scaffold, or bootstrap scaffold support from scratch if it isn't set up yet.

### Step 1 — detect state

Check whether `bin/sync-from-scaffold.sh` exists in the current working directory.

```bash
test -f bin/sync-from-scaffold.sh && echo "local" || echo "bootstrap"
```

### Step 2 — act

**If the script exists (already scaffolded):**

```bash
bash bin/sync-from-scaffold.sh
```

Report the output verbatim. If there are conflicts, list the conflicting files and tell the user to resolve the markers, commit, then re-run.

**If the script is missing (not yet scaffolded):**

```bash
curl -fsSL https://raw.githubusercontent.com/victusfate/scaffold/main/bin/bootstrap.sh | bash
```

This downloads and runs the bootstrap script, which clones the scaffold manifest and copies all listed files into the repo. Report what was installed.

### Step 3 — report

After either path, summarize:

- Which path ran (bootstrap vs sync)
- Files updated, skipped, or conflicted
- Next step if action is needed (resolve conflicts, commit, etc.)

### Repos without scaffold support

A repo with no `bin/sync-from-scaffold.sh` is treated as uninitialized. The bootstrap path handles it — no manual setup needed before running this skill.
