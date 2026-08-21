// queue-io.ts — the work queue's filesystem home, shared by the CLI
// (queue.ts) and the console server (queue-console.ts): resolve the queue
// file, load/save through the model round-trip so the format never corrupts,
// and append the audit-log / archive sidecars.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQueue, serializeQueue, type Queue, type Task } from './queue-model.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_DIR = join(ROOT, '.agent', 'queue');

export function queueFile(): string { return process.env.QUEUE_FILE ?? join(QUEUE_DIR, 'queue.md'); }
export function sidecar(name: string): string { return join(dirname(queueFile()), name); }
export function now(): string { return new Date().toISOString(); }

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
