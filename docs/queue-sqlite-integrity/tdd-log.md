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

## Independent review round

A fresh-context reviewer found six issues (red `ec` commit below, green after):
1. `import` of a stale view silently deleted tasks and rewound claimed ones → report `removed`/`statusChanges`, refuse without `--force`.
2. Renumbered already-issued ids left dependents pointing at nothing → deps follow the rename.
3. `--separate-git-dir`/submodule layouts fell back to per-checkout stores → main worktree from `git worktree list --porcelain`.
4. View written before COMMIT, and ROLLBACK could mask the real error → view (atomic temp+rename) and log lines are deferred until after COMMIT, and a failed ROLLBACK is ignored.
5. `QUEUE_FILE=x.db` aliased view and store → `x.db.db`.
6. `.gitignore` written for explicit paths / already-ignored stores → only for the default store when git doesn't already ignore it.

Not changed: during an upgrade, an old process still locks `queue.md.lock` while new ones lock `queue.db.lock`. The view hash guard fails that case closed.
