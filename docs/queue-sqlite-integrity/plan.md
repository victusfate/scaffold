# Queue SQLite integrity — plan

Vertical slices, each RED → GREEN → REFACTOR with `npm test` green.

1. **Store round-trip + PK** — `queue-db.ts` schema, `readStore`/`writeStore`;
   `queue-io` `load`/`save` backed by it; view rendered on save. Test: save/load
   round-trip, persisted duplicate ids throw and roll back, `nextId` monotonic.
2. **Dedupe + import/render + bootstrap** — pure `dedupeIds`; `queue import
   [--dry-run]`, `queue render`; automatic import of a pre-DB view. Test: the
   1106–1112 scenario renumbers with a report and flags deps.
3. **Hand-edit guard** — per-path view hash; saves fail closed on an edited view.
   Test: edit view → mutation exits non-zero, view unchanged; import applies.
4. **Shared DB across worktrees** — default `dbFile()` resolves through the git
   common dir; console watches the DB. Test: shell test adds from main checkout
   and a worktree → unique ids in one store.
5. **Distribution + docs** — scaffold-files, gitignore, skill text, CLI usage.
