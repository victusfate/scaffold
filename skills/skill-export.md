## Instructions

Export one or more scaffold skills into a target repo in the requested harness format. Wraps `tools/capability-export/run` — do not reimplement its logic here.

### Step 1 — resolve arguments

Collect from what the user said (or ask once if missing):

- **Names** — which capabilities to export. Accept a comma-separated list or `all`. If the user is unsure, run `--list` first and show them.
- **Harness** — `claude` (default), `cursor`, `antigravity`, or `all`.
- **Destination** — the `--into` path (the target repo root). Must be provided; do not guess.
- **Force** — whether to overwrite differing files. Default: no (sidecars are written instead). Only set `--force` if the user explicitly asks.

If any required arg is missing, ask for it once. Do not proceed until you have `names` and `into`.

### Step 2 — optionally list available capabilities

If the user is unsure what to export or asks to see options:

```bash
node tools/capability-export/run --list
```

Present the capability names and purposes in a readable list. Then ask which ones they want.

### Step 3 — run the export

```bash
node tools/capability-export/run \
  --names <names> \
  --harness <harness> \
  --into <destination> \
  [--force]
```

### Step 4 — report results

Parse the JSON manifest from stdout. Group by status and report:

- **Written** — files newly emitted.
- **Unchanged** — files that were already up to date (mention count only).
- **Sidecar** — files where a differing version existed; the incoming copy was saved as `<file>.scaffold-new`. Tell the user to diff and merge deliberately, then re-run if they want to commit the update.
- **Kept** — files protected by `.scaffold-keep` (skipped as intended).

If any sidecars were created, list them explicitly so the user knows what to review.

If the exit code is non-zero, surface stderr verbatim and stop.
