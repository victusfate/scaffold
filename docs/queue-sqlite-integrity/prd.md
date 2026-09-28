# Queue SQLite integrity — PRD

## Goal
Task ids are unique and never recycled, enforced by the storage layer rather than
by convention, for every queue surface (CLI, console, lanes, gates).

## Requirements
1. **R1** Queue state persists in SQLite via built-in `node:sqlite`; no new npm deps.
2. **R2** `tasks.id` is a primary key; no code path can persist two tasks with one id.
3. **R3** `nextId` is monotonic across saves, removals, archives, and imports.
4. **R4** One shared DB per repository (main checkout), git-ignored; `QUEUE_FILE` /
   `QUEUE_DB` isolate tests and alternate queues.
5. **R5** `queue.md` is re-rendered after every mutation. A hand-edited view is
   never silently overwritten: saves fail closed with a message naming
   `queue import` / `queue render`.
6. **R6** `queue import [--dry-run]` applies the view: later duplicate ids are
   renumbered, id-less tasks get fresh ids, deps pointing at a duplicated id are
   flagged, and the report goes to stdout and `log.md`.
7. **R7** First use migrates an existing `queue.md` automatically through R6.
8. **R8** Existing CLI/console behavior and tests keep passing; the lock fails
   closed exactly as before, now at `<db>.lock`.
9. **R9** New module is distributed by sync (`.github/scaffold-files.txt`) and the
   skill documents the store/view split.

## Out of scope
Moving lane heartbeats, `log.md`, or `archive.md` into SQLite.

## Acceptance
- Seeding a view with `task-1106` twice and running any CLI command yields
  distinct ids, a printed `task-1106 → task-NNNN` map, and a `log.md` entry.
- Two worktrees of one repo adding tasks produce one list with unique ids.
- `npm test`, `npm run typecheck`, `npm run lint` pass.
