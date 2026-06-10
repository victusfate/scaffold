# sync

Zero-local-code consumer sync for external scaffold consumers. One command
promotes scaffold files into the consumer repo per its `.sync/policy.yaml` and
replays hoisted skills from its `.sync/hoisted` manifest.

```
npx github:victusfate/scaffold sync [--into <path>] [--ref <ref>] [--check] [--force]
```

## How it works

1. Reads `.sync/policy.yaml` in the consumer repo (missing policy → exit 1):
   - `files.copy` — promoted as-is
   - `files.guarded` — promoted only while the incoming content still contains
     the declared `keep_marker`
   - `files.protected` — never written
   - `skills.manifest` — path to the hoisted-skills manifest to replay
   Unknown keys are rejected (a typo'd section must not reclassify entries).
2. Every write goes through the shared clobber-safe engine
   (`tools/lib/safe-write.mjs`): `.scaffold-keep` paths are never touched, and
   a differing destination gets a `*.scaffold-new` sidecar unless `--force`.
3. If the manifest exists, skills are re-hoisted at `--ref` (or the policy
   `ref`, then `main`). With `--check`, the replay count is reported instead.

The provenance line names both sources, e.g.
`scaffold sync  files=package@0.5.0  skills-ref=main  into=/repo`. File
promotion reads the npx package checkout (pin it with
`npx github:victusfate/scaffold#<tag>`); only skill hoisting resolves `--ref`.

## Example

```
$ npx github:victusfate/scaffold sync --check
scaffold sync  files=package@0.5.0  skills-ref=main  into=/work/app  (--check)
  would-sidecar    AGENTS.md
  would-protected  MIND.md
  would-replay     3 skill(s) from .sync/hoisted

done. (dry run — no files written)
```

## Tests

- `tools/sync/test` — acceptance suite (parser, promotion engine, orchestrator)
- `RUN_INTEGRATION=1 tools/sync/test-integration` — end-to-end consumer
  lifecycle in a real temp dir
