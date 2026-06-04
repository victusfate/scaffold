# TDD log: clobber-safe sync

| Slice | Status | Notes |
|---|---|---|
| 1 — C1: remove CLAUDE.md from manifest | DONE | `grep` returns 0; acceptance check passed |
| 2 — C2a: no-base sidecar | DONE | Manual check: sidecar created, target unchanged |
| 3 — C2b: .scaffold-keep | DONE | Manual check: glob match works, AGENTS.md not matched |
| 4 — C3: non-destructive bootstrap | DONE | `bash -n` passes; flags parsed correctly |
| 5 — doc updates | DONE | README + sync-scaffold skill updated |
| 6 — C4: v1.0 tag | PENDING | Tag after PR merges to main |
| B1 — authoring spec + manifest | DONE | docs/agent-authoring-requirements.md §0-6; added to scaffold-files.txt |
| B2 — surface at design phase | DONE | feature-chain + grill-with-docs reference spec at Q&A time |
| B3 — enforce at review | DONE | code-review Pass 3 checks §6 checklist |
| B4 — gate at create-pr | DONE | create-pr appends §6 checklist to PR body |
