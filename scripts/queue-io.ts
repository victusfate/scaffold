// queue-io.ts — the work queue's filesystem home, shared by the CLI
// (queue.ts) and the console server (queue-console.ts): resolve the SQLite
// store (the source of truth, queue-db.ts) and its rendered queue.md view,
// load/save through them, and append the audit-log / archive sidecars.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, openSync, closeSync, rmSync, renameSync,
} from 'node:fs';
import { join, dirname, extname, resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serializeQueue, formatDurationSecs, type Queue, type Task } from './queue-model.ts';
import {
  withStore, readStore, writeStore, planImport, formatReport, renderedHash, recordRender, isDestructive,
  QueueIntegrityError, type ImportReport, type Defer,
} from './queue-db.ts';
import type { DatabaseSync } from 'node:sqlite';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_DIR = join(ROOT, '.agent', 'queue');

/**
 * The rendered, human-readable view of the queue. Like the store it lives in the
 * main checkout, so lane worktrees never rewrite (and later merge back) a copy.
 * Sidecars (log, archive, lane heartbeats) sit beside it.
 */
export function queueFile(): string { return process.env.QUEUE_FILE ?? join(sharedQueueDir(), 'queue.md'); }

let sharedDir: string | null = null;

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * The main checkout's queue dir, so every linked worktree (each task lane)
 * resolves the same store and one id counter. `git worktree list` names the main
 * worktree first, whatever the git-dir layout (`--separate-git-dir`, submodules).
 * Outside a git checkout it is this checkout's queue dir.
 */
function sharedQueueDir(): string {
  if (sharedDir) return sharedDir;
  sharedDir = QUEUE_DIR;
  try {
    const main = gitIn(ROOT, ['worktree', 'list', '--porcelain']).match(/^worktree (.+)$/m)?.[1];
    if (main && existsSync(main)) sharedDir = join(main, '.agent', 'queue');
  } catch { /* not a git checkout */ }
  return sharedDir;
}

/**
 * The SQLite store. `QUEUE_DB` wins; an explicit `QUEUE_FILE` gets its own store
 * beside it (same name, `.db` extension) so isolated queues stay isolated;
 * otherwise the one store shared by every worktree of this repository.
 */
export function dbFile(): string {
  if (process.env.QUEUE_DB) return process.env.QUEUE_DB;
  const view = process.env.QUEUE_FILE;
  if (view) {
    const store = view.slice(0, view.length - extname(view).length) + '.db';
    return store === view ? `${view}.db` : store; // a `.db` view must not alias its store
  }
  return join(sharedQueueDir(), 'queue.db');
}
export function sidecar(name: string): string { return join(dirname(queueFile()), name); }
export function now(): string { return new Date().toISOString(); }

// ---------------------------------------------------------------- locking

// Queue mutations span read → mutate → write, so an exclusive sidecar prevents
// concurrent CLI and console processes from saving stale snapshots. A lock is
// never age-stolen: a slow, live process is indistinguishable from a dead one.
// Contenders wait only this bounded interval, then fail loudly for an operator
// to inspect/remove a lock left by a confirmed-dead holder.
const LOCK_POLL_MS = 20;
const LOCK_WAIT_MS = 60_000;
let held: { fd: number; path: string } | null = null;

function lockPath(): string { return `${dbFile()}.lock`; }

function napSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquire(): void {
  const path = lockPath();
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeFileSync(fd, `pid=${process.pid} acquiredAt=${now()}\n`);
      } catch (error) {
        closeSync(fd);
        rmSync(path, { force: true });
        throw error;
      }
      held = { fd, path };
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error(`queue: lock ${path} remained held for ${LOCK_WAIT_MS}ms; `
          + 'confirm its holder is dead before removing it', { cause: error });
      }
      napSync(LOCK_POLL_MS);
    }
  }
}

function release(): void {
  if (!held) return;
  const lock = held;
  held = null;
  closeSync(lock.fd);
  rmSync(lock.path, { force: true });
}

/** Run a queue transaction under the process-wide, cross-process exclusive lock. */
export function withLock<T>(fn: () => T): T {
  if (held) return fn();
  acquire();
  try { return fn(); } finally { release(); }
}

/**
 * Release a held queue lock around unbounded work, then retake it. Callers must
 * reload after this returns because another process may have committed changes.
 */
export function unlocked<T>(fn: () => T): T {
  if (!held) return fn();
  release();
  try { return fn(); } finally { acquire(); }
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Refuse to overwrite a view someone edited since the store last rendered it:
 * those edits (a hand reorder, a git merge) exist nowhere else. A path the store
 * never rendered (e.g. a fresh checkout's git copy) is fair to replace.
 */
function assertViewUnedited(db: DatabaseSync, path: string): void {
  const recorded = renderedHash(db, path);
  if (recorded === null || !existsSync(path) || sha256(readFileSync(path, 'utf8')) === recorded) return;
  throw new QueueIntegrityError(`queue: ${path} changed since the store last rendered it, `
    + 'so it was not overwritten and nothing was saved. Preview what the file would change with '
    + '`node scripts/queue.ts import --dry-run`. If you edited it, apply the edits with `import`. '
    + 'If git swapped in another copy (checkout, pull, merge, stash), `node scripts/queue.ts render` '
    + 'rewrites it from the store.');
}

/**
 * Record the view `q` (the store's contents) renders to, and write it once the
 * transaction commits: via a temp file + rename, so a reader never sees half a file.
 */
function renderView(db: DatabaseSync, defer: Defer, q: Queue, { discardEdits = false } = {}): void {
  const p = resolve(queueFile());
  if (!discardEdits) assertViewUnedited(db, p);
  const md = serializeQueue(q);
  recordRender(db, p, sha256(md));
  defer(() => {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, md);
    renameSync(tmp, p);
  });
}

function readView(): string {
  return existsSync(queueFile()) ? readFileSync(queueFile(), 'utf8') : '';
}

/**
 * Apply the view to the store (deduping ids), re-render it, and log the report.
 * Dropping or rewinding stored work needs `force`: a stale view (git restored an
 * older copy) looks exactly like a deliberate deletion.
 */
function applyView(db: DatabaseSync, defer: Defer, source: string, force: boolean): ImportReport {
  const { queue, report } = planImport(db, readView());
  if (!force && isDestructive(report)) {
    throw new QueueIntegrityError([`queue ${source}: refusing to apply ${queueFile()} — it would`,
      ...formatReport(report).filter(l => !l.startsWith('renumbered') && !/^\s+\S+ → /.test(l)),
      'Re-run with `--force` if that is intended, or `node scripts/queue.ts render` to discard the file.',
    ].join('\n'));
  }
  renderView(db, defer, persistQueue(db, defer, queue), { discardEdits: true });
  const lines = formatReport(report);
  defer(() => { for (const line of lines) log(`${source}: ${line.trim()}`); });
  return report;
}

/**
 * Keep the binary store out of git: committed copies from two branches cannot
 * merge, which would reintroduce the diverging-counter problem it exists to fix.
 */
function ignoreStore(): void {
  if (process.env.QUEUE_DB || process.env.QUEUE_FILE) return; // explicit paths are the caller's to manage
  try { gitIn(dirname(dbFile()), ['check-ignore', '-q', dbFile()]); return; } catch { /* not ignored yet */ }
  const ignore = join(dirname(dbFile()), '.gitignore');
  const pattern = `${basename(dbFile())}*`;
  const have = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  if (have.split('\n').includes(pattern)) return;
  appendFileSync(ignore, `${have && !have.endsWith('\n') ? '\n' : ''}`
    + `# work-queue store: the source of truth; queue.md is its committed view\n${pattern}\n`);
}

/**
 * Open the store for one transaction. A store's first open migrates the existing
 * view into it, so pre-SQLite queues (duplicates and all) carry over; the
 * renumbering report goes to stderr and log.md.
 */
function openStore<T>(fn: (db: DatabaseSync, defer: Defer) => T): T {
  mkdirSync(dirname(dbFile()), { recursive: true });
  return withStore(dbFile(), (db, fresh, defer) => {
    if (fresh) defer(ignoreStore);
    if (fresh && existsSync(queueFile())) {
      // A fresh store holds nothing to drop or rewind, so migration never needs force.
      const lines = formatReport(applyView(db, defer, 'migrate', false));
      if (lines.length) {
        defer(() => process.stderr.write(`queue: migrated ${queueFile()} into ${dbFile()}; `
          + `${lines.join('\n')}\n`));
      }
    }
    return fn(db, defer);
  });
}

export function load(): Queue {
  return openStore(db => readStore(db));
}

/** Persist `q` to the store, then re-render the view — one transaction. */
export function save(q: Queue): void {
  withLock(() => openStore((db, defer) => renderView(db, defer, persistQueue(db, defer, q))));
}

/** Clear ended lane display metadata and its cooperative stop request. */
export function clearLane(id: string): void {
  const directory = join(dirname(queueFile()), 'lanes');
  rmSync(join(directory, `${id}.json`), { force: true });
  rmSync(join(directory, `${id}.stop`), { force: true });
}

/** End display metadata only after a persisted lifecycle change commits. */
function persistQueue(db: DatabaseSync, defer: Defer, q: Queue): Queue {
  const before = readStore(db);
  const persisted = writeStore(db, q);
  const after = new Map(persisted.tasks.map(task => [task.id, task]));
  for (const previous of before.tasks) {
    const next = after.get(previous.id);
    if (!next || (next.status !== 'active' && (
      previous.status !== next.status || previous.owner !== next.owner
      || previous.startedAt !== next.startedAt || previous.failures !== next.failures
    ))) defer(() => clearLane(previous.id));
  }
  return persisted;
}

/**
 * `queue import`: replace the store's tasks with the (hand-edited) view's,
 * renumbering duplicate or already-issued ids. A dry run only reports.
 */
export function importView(dryRun: boolean, force = false): ImportReport {
  if (!existsSync(queueFile())) {
    throw new QueueIntegrityError(`queue: no view to import at ${queueFile()} — nothing changed `
      + '(run `node scripts/queue.ts render` to recreate it from the store)');
  }
  return openStore((db, defer) => (dryRun
    ? planImport(db, readView()).report : applyView(db, defer, 'import', force)));
}

/** `queue render`: rewrite the view from the store, discarding hand edits to it. */
export function renderFromStore(): void {
  openStore((db, defer) => renderView(db, defer, readStore(db), { discardEdits: true }));
}

export function log(msg: string): void {
  appendFileSync(sidecar('log.md'), `- ${now()} ${msg}\n`);
}

/** Append a batch of finished tasks to the git-ignored archive.md audit log. */
export function appendArchive(tasks: Task[]): void {
  const block = `\n## Archived ${now()}\n\n`
    + tasks.map(t => `- [${t.status === 'done' ? 'x' : '!'}] ${t.id} — ${t.title}`
      + (t.elapsedSecs ? ` · ⏱${formatDurationSecs(t.elapsedSecs)}` : '')).join('\n') + '\n';
  appendFileSync(sidecar('archive.md'), block);
}
