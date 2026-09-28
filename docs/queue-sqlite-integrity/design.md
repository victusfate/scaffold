# Queue SQLite integrity — design

## Problem

A consumer repo's `.agent/queue/queue.md` carried task ids `task-1106`…`task-1112`
twice each, on unrelated tasks. Root cause, traced in scaffold:

- The id counter (`nextId`) lives *inside* the committed `queue.md`. Two branches or
  worktrees that each `add` hand out the same next ids; a git merge unions both
  task lists. Hand edits can do the same.
- `parseQueue` accepts duplicate ids silently, and every mutation keys on id:
  `mapTask` (`scripts/queue-model.ts:373`) rewrites **all** matches and
  `removeTask` drops all of them — one `done task-1106` completes two tasks.

## Q&A (resolved with the user)

| Question | Decision |
|---|---|
| Binding? | Built-in `node:sqlite` — no dependency, no native build. Its ExperimentalWarning is filtered. |
| Where does the DB live? | One shared, git-ignored `queue.db` in the **main checkout's** `.agent/queue/` (resolved via `git rev-parse --git-common-dir`), so every worktree/lane hands out ids from one place. |
| What is `queue.md` now? | A **generated view**, rewritten from the DB after every mutation (still committed/readable). Hand edits enter via `queue import`. |
| Existing duplicates on migration? | **Renumber + report**: the first occurrence keeps its id, later ones get fresh ids; an old→new map is printed and logged; deps naming a duplicated id are flagged. |

## Decisions

- **D1 Store.** `queue-db.ts` owns the schema and all SQL. `tasks.id TEXT PRIMARY KEY`
  makes a duplicate id unrepresentable — a save that would introduce one throws and
  the transaction rolls back. `position` orders priority. `meta` holds config and
  the monotonic `nextId`, which only ever moves up (`max(stored, model, maxId+1)`).
- **D2 Seam.** `queue-io.ts` `load()`/`save()` keep their signatures; only their
  backing changes. Model, CLI, console, and gates are untouched in behavior.
- **D3 Paths.** `dbFile()` = `QUEUE_DB` ?? (`QUEUE_FILE` set → same path with a `.db`
  extension, so isolated test queues stay isolated) ?? the shared main-checkout DB.
  The cross-process lock moves to `<db>.lock` because the DB, not the view, is the
  shared resource.
- **D4 Hand-edit guard (fail closed).** Each render records `sha256` of the view per
  absolute path. Before overwriting, if the file's hash differs from the recorded
  one, the save refuses with an actionable error (`queue import` to apply the
  edits, `queue render` to discard them). A path with no record (a fresh checkout's
  git copy) is overwritten.
- **D5 Bootstrap.** Opening a DB that has never been initialized imports the
  existing view (if any) through the same dedupe path as `queue import`, so
  existing consumer queues migrate automatically and duplicates are reported.
- **D6 Console liveness.** The console watches the DB file (rollback-journal mode
  rewrites it on commit), so a mutation from any worktree reaches the board.

## Scenarios

1. Two worktrees `add` concurrently → one DB, one counter, distinct ids.
2. A merge unions two `queue.md` copies with colliding ids → next mutation fails
   closed; `queue import` renumbers the later duplicates and prints the map.
3. A human reorders `queue.md` by hand → `queue import` applies it.
4. First run in a consumer with a pre-DB `queue.md` → automatic import.

## Canonical vocabulary

- **store / DB** — `queue.db`, the source of truth.
- **view** — `queue.md`, rendered from the store; never read back implicitly
  except at bootstrap.
- **import** — replace the store's task list with the view's, deduping ids.
- **render** — rewrite the view from the store, discarding hand edits.
- **dedupe report** — the `old → new` renumbering map plus flagged deps.
