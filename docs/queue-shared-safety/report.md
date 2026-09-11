# Shared queue safety

Scaffold is the implementation owner of the queue CLI, console, and persistence
helpers. Consumer projects keep their task data and configuration, not separate
copies of queue behavior. Fixes needed by a consumer belong in a scaffold PR
with regression tests and sync-manifest registration.

## Defects carried by the consumer

- Concurrent CLI/console read-modify-write operations could overwrite another
  worker's task records. Mutation must hold one cross-process queue lock.
- Task validation runs arbitrary, potentially long commands. It must not hold
  the queue lock, and must reload state before recording its result.
- CLI title/note edits could succeed without persisting the requested change.
  Tests must exercise the actual CLI and re-read its persisted queue file.

## Integration contract

Keep the existing queue commands and data format. Test against isolated queue
files, never a consumer's live queue. Include regression tests in the normal
test entry point and distribute runtime modules through scaffold sync.
Do not steal locks solely because they are old: a slow live holder still owns
its critical section. An abandoned lock must fail closed with an actionable
diagnostic rather than silently allow concurrent writers.
