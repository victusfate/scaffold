# TDD log: clobber-safe sync

| Slice | Status | Notes |
|---|---|---|
| 1 — C1: remove CLAUDE.md from manifest | DONE | `grep` returns 0; acceptance check passed |
| 2 — C2a: no-base sidecar | DONE | Manual check: sidecar created, target unchanged |
| 3 — C2b: .scaffold-keep | DONE | Manual check: glob match works, AGENTS.md not matched |
| 4 — C3: non-destructive bootstrap | DONE | `bash -n` passes; flags parsed correctly |
| 5 — doc updates | DONE | README + sync-scaffold skill updated |
| 6 — C4: v1.0 tag | PENDING | Tag after PR merges to main |
