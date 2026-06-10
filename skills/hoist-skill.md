## Instructions

Export one or more scaffold skills into a target repo in the requested harness format. Wraps `tools/hoist-skill/run` — do not reimplement its logic here.

### Step 1 — resolve arguments

Collect from what the user said (or ask once if missing):

- **Names** — which capabilities to export. Accept a comma-separated list or `all`. If the user is unsure, run `--list` first and show them.
- **Harness** — `claude` (default), `cursor`, `antigravity`, or `all`.
- **Destination** — the `--into` path (the target repo root). Must be provided; do not guess.
- **Force** — whether to overwrite differing files. Default: no (sidecars are written instead). Only set `--force` if the user explicitly asks.
- **Ref** — optional scaffold ref to stamp in the manifest (`--ref <tag|commit>`, default `main`). Use when the consumer pins to a specific release.
- **No-record** — pass `--no-record` only if the user explicitly asks to skip manifest registration.

If any required arg is missing, ask for it once. Do not proceed until you have `names` and `into`.

### Step 2 — optionally list available capabilities

If the user is unsure what to export or asks to see options:

```bash
node tools/hoist-skill/run --list
```

Present the capability names and purposes in a readable list. Then ask which ones they want.

### Step 3 — run the export

```bash
node tools/hoist-skill/run \
  --names <names> \
  --harness <harness> \
  --into <destination> \
  [--ref <ref>] \
  [--force] \
  [--no-record]
```

After a successful emit the tool automatically writes (or updates) `<destination>/.sync/hoisted` — a tab-separated manifest recording each `(name, harness, ref)` triple. This is what lets consumers refresh hoisted skills on the next sync without re-typing the names list.

### Step 4 — report results

Parse the JSON manifest from stdout. Group by status and report:

- **Written** — files newly emitted.
- **Unchanged** — files that were already up to date (mention count only).
- **Sidecar** — files where a differing version existed; the incoming copy was saved as `<file>.scaffold-new`. Tell the user to diff and merge deliberately, then re-run if they want to commit the update.
- **Kept** — files protected by `.scaffold-keep` (skipped as intended).

If any sidecars were created, list them explicitly so the user knows what to review.

Remind the user to commit `<destination>/.sync/hoisted` so the registration survives across sessions and devices.

If the exit code is non-zero, surface stderr verbatim and stop.

---

### Replay mode — `--from-manifest`

To re-emit all previously registered skills (e.g., after a scaffold update or on a fresh clone):

```bash
node tools/hoist-skill/run \
  --from-manifest \
  --into <destination>
```

This reads `<destination>/.sync/hoisted` and re-emits every recorded `(name, harness)` pair. Clobber-safe: unchanged files are skipped, locally edited files become sidecars, `.scaffold-keep` paths are honored.

Pass an explicit path to use a non-default manifest location:

```bash
node tools/hoist-skill/run --from-manifest path/to/hoisted --into <destination>
```

`--from-manifest` and `--names` are mutually exclusive.

---

### Plan mode — `--plan`

For pull-only consumers (no scaffold clone, curl-only) that need to know which files to fetch before emitting:

```bash
node tools/hoist-skill/run \
  --names <names> \
  --harness <harness> \
  --plan
```

Outputs a JSON source list to stdout without writing any files:

```json
{
  "ref": "main",
  "harness": "claude",
  "sources": [
    { "path": "tools/hoist-skill/run", "required": true },
    { "path": ".claude/skills/RESOLVER.md", "required": true },
    { "path": "skills/tdd.md", "required": true, "ref": "main" },
    { "path": ".claude/skills/tdd/SKILL.md", "required": false, "ref": "main" }
  ]
}
```

`required: true` sources must exist at the consumer before emitting;
`required: false` sources are generated when absent. The consumer curls each
`path` at its `ref`, then runs `--from-manifest --into .` to re-emit. Combine with `--from-manifest` to get the source list for all registered skills at once:

```bash
node tools/hoist-skill/run --from-manifest --plan
```
