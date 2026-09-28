// queue-db.ts — the work queue's SQLite store, the source of truth for queue
// state. `queue.md` is a rendered view of it (see queue-io.ts). The schema, not
// convention, carries the integrity guarantees:
//
//   - `tasks.id` is the primary key, so two tasks can never share an id;
//   - `meta.nextId` only moves up, so an issued id is never handed out again,
//     even after the task is removed or archived.
//
// Uses Node's built-in `node:sqlite` (no dependency, no native build).

import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_CONFIG, assignIds, fmtId, idNum, parseQueue, type Queue, type QueueConfig, type Task,
} from './queue-model.ts';

// node:sqlite prints an ExperimentalWarning on first load. It is emitted
// synchronously by the require itself, so filter exactly that warning around it.
function loadSqlite(): typeof import('node:sqlite') {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- only ever invoked via .call(process) and restored verbatim
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning instanceof Error ? warning.message : warning).startsWith('SQLite is an experimental')) return;
    (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try { return createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite'); }
  finally { process.emitWarning = emit; }
}
const { DatabaseSync: Database } = loadSqlite();

const BUSY_TIMEOUT_MS = 5000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY NOT NULL CHECK (id <> ''),
  position     INTEGER NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'active', 'done', 'failed')),
  mode         TEXT NOT NULL CHECK (mode IN ('direct', 'chain')),
  held         INTEGER NOT NULL CHECK (held IN (0, 1)),
  elapsed_secs INTEGER NOT NULL CHECK (elapsed_secs >= 0),
  slug         TEXT,
  depends_on   TEXT NOT NULL,
  files        TEXT NOT NULL,
  validate     TEXT,
  accept       TEXT,
  note         TEXT,
  failures     INTEGER NOT NULL CHECK (failures >= 0),
  owner        TEXT,
  branch       TEXT,
  worktree     TEXT,
  started_at   TEXT
);
CREATE TABLE IF NOT EXISTS views (
  path   TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL
);
`;

type Row = Record<string, string | number | null>;

/**
 * A refused write that would break queue integrity (duplicate or recycled id,
 * or overwriting a hand-edited view). Callers report its message and fail.
 */
export class QueueIntegrityError extends Error {}

/** Queue a side effect (file write, log line) to run only once the transaction commits. */
export type Defer = (effect: () => void) => void;

/**
 * Open (creating if needed) the store at `path` and run `fn` in one
 * write transaction; any throw rolls the whole transaction back. `fresh` is true
 * when this call initialized the store, so the caller can migrate into it.
 * Effects passed to `defer` run after COMMIT, so a rolled-back transaction never
 * leaves a view or log line describing state the store does not hold.
 */
export function withStore<T>(path: string, fn: (db: DatabaseSync, fresh: boolean, defer: Defer) => T): T {
  const db = new Database(path);
  const effects: Array<() => void> = [];
  let out: T;
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(SCHEMA);
      const fresh = getMeta(db, 'initialized') === null;
      if (fresh) setMeta(db, 'initialized', new Date().toISOString());
      out = fn(db, fresh, effect => effects.push(effect));
      db.exec('COMMIT');
    } catch (error) {
      // SQLite may already have rolled back (e.g. a failed COMMIT); keep the real error.
      try { db.exec('ROLLBACK'); } catch { /* no transaction left to roll back */ }
      throw error;
    }
  } finally {
    db.close();
  }
  for (const effect of effects) effect();
  return out;
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
  return row ? String(row.value) : null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) '
    + 'ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** The sha256 the store last rendered to the view at `path` (null if never). */
export function renderedHash(db: DatabaseSync, path: string): string | null {
  const row = db.prepare('SELECT sha256 FROM views WHERE path = ?').get(path) as Row | undefined;
  return row ? String(row.sha256) : null;
}

export function recordRender(db: DatabaseSync, path: string, sha256: string): void {
  db.prepare('INSERT INTO views (path, sha256) VALUES (?, ?) '
    + 'ON CONFLICT (path) DO UPDATE SET sha256 = excluded.sha256').run(path, sha256);
}

/** The persisted id counter (1 for a new store). */
export function storedNextId(db: DatabaseSync): number {
  return Math.max(1, Number(getMeta(db, 'nextId')) || 1);
}

function rowToTask(r: Row): Task {
  const text = (v: Row[string]): string | null => (v === null ? null : String(v));
  return {
    id: String(r.id), title: String(r.title), status: r.status as Task['status'],
    mode: r.mode as Task['mode'], held: r.held === 1, elapsedSecs: Number(r.elapsed_secs),
    slug: text(r.slug), dependsOn: JSON.parse(String(r.depends_on)) as string[],
    files: JSON.parse(String(r.files)) as string[], validate: text(r.validate),
    accept: text(r.accept), note: text(r.note), failures: Number(r.failures),
    owner: text(r.owner), branch: text(r.branch), worktree: text(r.worktree),
    startedAt: text(r.started_at),
  };
}

export function readStore(db: DatabaseSync): Queue {
  const saved = getMeta(db, 'config');
  const config: QueueConfig = {
    ...DEFAULT_CONFIG,
    ...(saved ? JSON.parse(saved) as Partial<QueueConfig> : {}),
    nextId: storedNextId(db),
  };
  const rows = db.prepare('SELECT * FROM tasks ORDER BY position').all() as Row[];
  return { config, tasks: rows.map(rowToTask) };
}

/**
 * Refuse a task list that would break id integrity: a repeated id, or an id that
 * is new to the store yet below its counter (already issued, then removed).
 */
function assertIdIntegrity(db: DatabaseSync, tasks: Task[]): void {
  const present = new Set((db.prepare('SELECT id FROM tasks').all() as Row[]).map(r => String(r.id)));
  const next = storedNextId(db);
  const seen = new Set<string>();
  for (const { id } of tasks) {
    if (!id) continue;
    if (seen.has(id)) {
      throw new QueueIntegrityError(`queue: duplicate task id ${id} — refusing to save (run \`queue import\` to renumber)`);
    }
    seen.add(id);
    const n = idNum(id);
    if (!present.has(id) && n > 0 && n < next) {
      throw new QueueIntegrityError(`queue: ${id} was already issued — refusing to recycle it (counter is at ${next})`);
    }
  }
}

/**
 * Replace the store's contents with `q`. Id-less tasks get fresh ids from the
 * counter, and the counter never moves down. Returns the id-complete queue as
 * persisted, which is what the view must render.
 */
export function writeStore(db: DatabaseSync, q: Queue): Queue {
  assertIdIntegrity(db, q.tasks);
  const counter = Math.max(storedNextId(db), q.config.nextId);
  const { tasks, nextId } = assignIds({ config: { ...q.config, nextId: counter }, tasks: q.tasks });
  db.exec('DELETE FROM tasks');
  const insert = db.prepare(`INSERT INTO tasks (id, position, title, status, mode, held,
    elapsed_secs, slug, depends_on, files, validate, accept, note, failures, owner, branch,
    worktree, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  tasks.forEach((t, i) => insert.run(
    t.id, i, t.title, t.status, t.mode, t.held ? 1 : 0, Math.round(t.elapsedSecs), t.slug,
    JSON.stringify(t.dependsOn), JSON.stringify(t.files), t.validate, t.accept, t.note,
    t.failures, t.owner, t.branch, t.worktree, t.startedAt,
  ));
  const config: Partial<QueueConfig> = { ...q.config };
  delete config.nextId; // the counter lives in its own row
  setMeta(db, 'config', JSON.stringify(config));
  setMeta(db, 'nextId', String(nextId));
  return { config: { ...q.config, nextId }, tasks };
}

// ---------------------------------------------------------------- import

/** One id change made while importing a view, and why. */
export interface Rename { from: string; to: string; title: string; reason: 'duplicate' | 'already issued' }

/** What an import did (or, for a dry run, would do) to the view's tasks. */
export interface ImportReport {
  renames: Rename[];
  /** Deps that named a duplicated id; they still point at its first occurrence. */
  ambiguousDeps: Array<{ task: string; dep: string }>;
  /** Stored tasks the view no longer has — importing deletes them. */
  removed: Array<{ id: string; title: string }>;
  /** Stored tasks already claimed or finished whose status the view changes. */
  statusChanges: Array<{ id: string; title: string; from: string; to: string }>;
}

/** Whether applying the report would drop or rewind work (needs `--force`). */
export function isDestructive(r: ImportReport): boolean {
  return r.removed.length > 0 || r.statusChanges.length > 0;
}

/**
 * Make a parsed view's ids safe to store. The first task carrying an id keeps it;
 * a later task with the same id, or with an id the store issued and has since
 * dropped, gets a fresh id from the counter. Id-less (hand-added) tasks also get
 * fresh ids. Pure: `present` and `next` describe the store being imported into.
 */
export function dedupeIds(
  q: Queue, present: Set<string>, next: number,
): { queue: Queue; report: Pick<ImportReport, 'renames' | 'ambiguousDeps'> } {
  let n = Math.max(next, q.config.nextId, ...q.tasks.map(t => idNum(t.id) + 1));
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const renames: Rename[] = [];
  const tasks = q.tasks.map(t => {
    const recycled = !present.has(t.id) && idNum(t.id) > 0 && idNum(t.id) < next;
    if (t.id && !seen.has(t.id) && !recycled) { seen.add(t.id); return t; }
    const to = fmtId(n++);
    if (t.id) {
      renames.push({ from: t.id, to, title: t.title, reason: recycled ? 'already issued' : 'duplicate' });
      if (!recycled) duplicated.add(t.id);
    }
    return { ...t, id: to };
  });
  // An already-issued id is unambiguous within the view (the store no longer has
  // it), so its dependents follow the rename; a duplicated id stays with its first holder.
  const moved = new Map(renames.filter(r => r.reason === 'already issued').map(r => [r.from, r.to]));
  const remapped = tasks.map(t => (t.dependsOn.some(d => moved.has(d))
    ? { ...t, dependsOn: t.dependsOn.map(d => moved.get(d) ?? d) } : t));
  const ambiguousDeps = remapped.flatMap(t => t.dependsOn.filter(d => duplicated.has(d)).map(dep => ({ task: t.id, dep })));
  return { queue: { config: { ...q.config, nextId: n }, tasks: remapped }, report: { renames, ambiguousDeps } };
}

/** Dedupe a view's Markdown against the store and diff it, without writing anything. */
export function planImport(db: DatabaseSync, md: string): { queue: Queue; report: ImportReport } {
  const stored = readStore(db).tasks;
  const { queue, report } = dedupeIds(parseQueue(md), new Set(stored.map(t => t.id)), storedNextId(db));
  const incoming = new Map(queue.tasks.map(t => [t.id, t]));
  const removed = stored.filter(t => !incoming.has(t.id)).map(t => ({ id: t.id, title: t.title }));
  const statusChanges = stored.flatMap(t => {
    const next = incoming.get(t.id);
    return next && t.status !== 'pending' && next.status !== t.status
      ? [{ id: t.id, title: t.title, from: t.status, to: next.status }] : [];
  });
  return { queue, report: { ...report, removed, statusChanges } };
}

/** Human-readable lines for an import report (empty when nothing changed). */
export function formatReport(r: ImportReport): string[] {
  const lines: string[] = [];
  if (r.renames.length) {
    lines.push(`renumbered ${r.renames.length} task id(s) to keep ids unique:`,
      ...r.renames.map(x => `  ${x.from} → ${x.to} — ${x.title}${x.reason === 'duplicate' ? '' : ` (${x.reason})`}`),
      ...r.ambiguousDeps.map(d => `  ! ${d.task} deps: ${d.dep} named a duplicated id — it now means the `
        + `first ${d.dep}; verify`));
  }
  if (r.removed.length) {
    lines.push(`deletes ${r.removed.length} task(s) the view no longer lists:`,
      ...r.removed.map(x => `  ${x.id} — ${x.title} (removed)`));
  }
  if (r.statusChanges.length) {
    lines.push(`changes the status of ${r.statusChanges.length} claimed/finished task(s):`,
      ...r.statusChanges.map(x => `  ${x.id} — ${x.title}: ${x.from} → ${x.to}`));
  }
  return lines;
}
