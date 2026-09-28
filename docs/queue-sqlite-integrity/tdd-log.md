# Queue SQLite integrity — TDD log

| Slice | Red | Green | Notes |
|---|---|---|---|
| 1 Store round-trip + PK | `3115275` | `03387e0` | `queue-db.ts` schema; `load`/`save` backed by it; stale-counter save refused. |
| 2 Dedupe, import/render, migration | `af6ac38` | `03387e0` | The 1106–1112 scenario renumbers with an `old → new` report in stderr and `log.md`. Refactor `e751eed` split worktree verbs out of `queue.ts` (was 505 lines). |
| 3 Hand-edit guard | `72e7be8` | `30397e0` | Per-path sha256; CLI exits 1 with remedy, console 409; archive written only after save. |
| 4 Shared store across worktrees | `1972026` | `02206ab` | Git common dir → main checkout; store self-ignores; console watches the store. |
| 5 Distribution + docs | — | `d9ed966` | Skill, view header, scaffold-files. |
| Review fixes | (tests in same commit) | `a108c6a` | One view in the main checkout (lane merges no longer trip the guard); `import` refuses a missing view. |

Gate at each green: `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 errors).
