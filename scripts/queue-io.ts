// queue-io.ts — the work queue's filesystem home, shared by the CLI
// (queue.ts) and the console server (queue-console.ts): resolve the SQLite
// store (the source of truth, queue-db.ts) and its rendered queue.md view,
// load/save through them, and append the audit-log / archive sidecars.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, openSync, closeSync, rmSync,
} from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeQueue, formatDurationSecs, type Queue, type Task } from './queue-model.ts';
import {
  withStore, readStore, writeStore, planImport, formatReport, type ImportReport,
} from './queue-db.ts';
import type { DatabaseSync } from 'node:sqlite';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_DIR = join(ROOT, '.agent', 'queue');

/** The rendered, human-readable view of the queue. */
export function queueFile(): string { return process.env.QUEUE_FILE ?? join(QUEUE_DIR, 'queue.md'); }

/**
 * The SQLite store. `QUEUE_DB` wins; an explicit `QUEUE_FILE` gets its own store
 * beside it (same name, `.db` extension) so isolated queues stay isolated.
 */
export function dbFile(): string {
  if (process.env.QUEUE_DB) return process.env.QUEUE_DB;
  const view = process.env.QUEUE_FILE;
  if (view) return view.slice(0, view.length - extname(view).length) + '.db';
  return join(QUEUE_DIR, 'queue.db');
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

function renderView(q: Queue): void {
  const p = queueFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeQueue(q));
}

function readView(): string {
  return existsSync(queueFile()) ? readFileSync(queueFile(), 'utf8') : '';
}

/** Apply the view to the store (deduping ids), re-render it, and log the report. */
function applyView(db: DatabaseSync, source: string): ImportReport {
  const { queue, report } = planImport(db, readView());
  renderView(writeStore(db, queue));
  for (const line of formatReport(report)) log(`${source}: ${line.trim()}`);
  return report;
}

/**
 * Open the store for one transaction. A store's first open migrates the existing
 * view into it, so pre-SQLite queues (duplicates and all) carry over; the
 * renumbering report goes to stderr and log.md.
 */
function openStore<T>(fn: (db: DatabaseSync) => T): T {
  mkdirSync(dirname(dbFile()), { recursive: true });
  return withStore(dbFile(), (db, fresh) => {
    if (fresh && existsSync(queueFile())) {
      const lines = formatReport(applyView(db, 'migrate'));
      if (lines.length) process.stderr.write(`queue: migrated ${queueFile()} into ${dbFile()}; `
        + `${lines.join('\n')}\n`);
    }
    return fn(db);
  });
}

export function load(): Queue {
  return openStore(db => readStore(db));
}

/** Persist `q` to the store, then re-render the view — one transaction. */
export function save(q: Queue): void {
  openStore(db => renderView(writeStore(db, q)));
}

/**
 * `queue import`: replace the store's tasks with the (hand-edited) view's,
 * renumbering duplicate or already-issued ids. A dry run only reports.
 */
export function importView(dryRun: boolean): ImportReport {
  return openStore(db => (dryRun ? planImport(db, readView()).report : applyView(db, 'import')));
}

/** `queue render`: rewrite the view from the store, discarding hand edits to it. */
export function renderFromStore(): void {
  openStore(db => renderView(readStore(db)));
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
