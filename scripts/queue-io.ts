// queue-io.ts — the work queue's filesystem home, shared by the CLI
// (queue.ts) and the console server (queue-console.ts): resolve the queue
// file, load/save through the model round-trip so the format never corrupts,
// and append the audit-log / archive sidecars.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, openSync, closeSync, rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQueue, serializeQueue, type Queue, type Task } from './queue-model.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_DIR = join(ROOT, '.agent', 'queue');

export function queueFile(): string { return process.env.QUEUE_FILE ?? join(QUEUE_DIR, 'queue.md'); }
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

function lockPath(): string { return `${queueFile()}.lock`; }

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

export function load(): Queue {
  const p = queueFile();
  return existsSync(p) ? parseQueue(readFileSync(p, 'utf8')) : parseQueue('');
}

export function save(q: Queue): void {
  const p = queueFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeQueue(q));
}

export function log(msg: string): void {
  appendFileSync(sidecar('log.md'), `- ${now()} ${msg}\n`);
}

/** Append a batch of finished tasks to the git-ignored archive.md audit log. */
export function appendArchive(tasks: Task[]): void {
  const block = `\n## Archived ${now()}\n\n`
    + tasks.map(t => `- [${t.status === 'done' ? 'x' : '!'}] ${t.id} — ${t.title}`).join('\n') + '\n';
  appendFileSync(sidecar('archive.md'), block);
}
