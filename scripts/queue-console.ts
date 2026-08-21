#!/usr/bin/env node
// queue-console.ts — the queue's management console: a typed software interface
// over the work queue so every mutation (web page, agent, script) flows through
// validated operations instead of hand-editing Markdown. Pure core in this
// file's top half: ConsoleState (the derived snapshot the page renders) and
// applyOp (a validated dispatcher over the queue-model ops that also guards
// dependency integrity — unknown deps, cycles, and removals that would orphan
// dependents are rejected with the queue untouched).
//
// Management surface only, by design (docs/queue-console/design.md D3): no
// done/fail/claim/worktree ops and nothing here ever executes a shell command.

import {
  addTask, setField, removeTask, moveToTop, moveTask, requeueTask, setConfig,
  isEligible, deadlocked, drainSignal, splitList,
  type Queue, type QueueConfig, type Task,
} from './queue-model.ts';

// ---------------------------------------------------------------- contracts

export interface TaskPatch {
  title?: string; mode?: string; slug?: string; deps?: string;
  files?: string; validate?: string; accept?: string; note?: string;
}

const CONFIG_KEYS = [
  'interval', 'maxFailures', 'leaseMinutes', 'maxParallel',
  'integrationBranch', 'idlePoll', 'pausePoll',
] as const;
export type ConfigKey = typeof CONFIG_KEYS[number];
const NUMERIC_CONFIG_KEYS: ConfigKey[] = ['maxFailures', 'leaseMinutes', 'maxParallel'];

export type Op =
  | { op: 'add'; title: string; top?: boolean; fields?: TaskPatch }
  | { op: 'set'; id: string; fields: TaskPatch }
  | { op: 'remove' | 'top' | 'requeue'; id: string }
  | { op: 'move'; id: string; to: number }
  | { op: 'start' | 'stop' | 'archive' }
  | { op: 'config'; key: ConfigKey; value: string };

export type OpResult =
  | { ok: true; queue: Queue; archived: Task[] }
  | { ok: false; error: string };

export interface ConsoleTask extends Task { eligible: boolean; deadlocked: boolean }
export interface ConsoleState { config: QueueConfig; tasks: ConsoleTask[]; drain: string | null }

// ---------------------------------------------------------------- state

/** The derived snapshot the console page renders — model truth, not page logic. */
export function consoleState(q: Queue): ConsoleState {
  const stuck = new Set(deadlocked(q).map(t => t.id));
  return {
    config: q.config,
    tasks: q.tasks.map(t => ({ ...t, eligible: isEligible(t, q), deadlocked: stuck.has(t.id) })),
    drain: drainSignal(q),
  };
}

// ---------------------------------------------------------------- validation

const PATCHABLE = ['title', 'mode', 'slug', 'deps', 'files', 'validate', 'accept', 'note'] as const;

/** Convert a wire TaskPatch (all strings) into a model patch, or name the bad field. */
function parsePatch(fields: TaskPatch): { patch: Partial<Task> } | { error: string } {
  const unknown = Object.keys(fields).find(k => !(PATCHABLE as readonly string[]).includes(k));
  if (unknown) return { error: `unknown field: ${unknown}` };
  const patch: Partial<Task> = {};
  if (fields.title !== undefined) {
    if (!fields.title.trim()) return { error: 'title cannot be empty' };
    patch.title = fields.title.trim();
  }
  if (fields.mode !== undefined) patch.mode = fields.mode === 'chain' ? 'chain' : 'direct';
  if (fields.slug !== undefined) patch.slug = fields.slug.trim() || null;
  if (fields.deps !== undefined) patch.dependsOn = splitList(fields.deps);
  if (fields.files !== undefined) patch.files = splitList(fields.files);
  if (fields.validate !== undefined) patch.validate = fields.validate.trim() || null;
  if (fields.accept !== undefined) patch.accept = fields.accept.trim() || null;
  if (fields.note !== undefined) patch.note = fields.note.trim() || null;
  return { patch };
}

/**
 * Guard the dependency DAG for one task's proposed deps: every dep must name an
 * existing task, none may be the task itself, and following deps from the task
 * must never lead back to it (no cycles). `tasks` is the post-op task list.
 */
function depsError(tasks: Task[], id: string, deps: string[]): string | null {
  const byId = new Map(tasks.map(t => [t.id, t]));
  for (const d of deps) {
    if (d === id) return `self-dependency: ${id}`;
    if (!byId.has(d)) return `dependency on a nonexistent task: ${d}`;
  }
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === id) return `dependency cycle through ${id}`;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(byId.get(cur)?.dependsOn ?? []));
  }
  return null;
}

/** Unfinished tasks that still depend on `id` — removal would orphan them. */
function unfinishedDependents(q: Queue, id: string): Task[] {
  return q.tasks.filter(t => (t.status === 'pending' || t.status === 'active')
    && t.dependsOn.includes(id));
}

// ---------------------------------------------------------------- dispatch

const done = (queue: Queue, archived: Task[] = []): OpResult => ({ ok: true, queue, archived });
const reject = (error: string): OpResult => ({ ok: false, error });

function applyTaskPatch(q: Queue, id: string, fields: TaskPatch): OpResult {
  const parsed = parsePatch(fields);
  if ('error' in parsed) return reject(parsed.error);
  if (parsed.patch.dependsOn) {
    const bad = depsError(q.tasks, id, parsed.patch.dependsOn);
    if (bad) return reject(bad);
  }
  return done(setField(q, id, parsed.patch));
}

function applyAdd(q: Queue, op: { title: string; top?: boolean; fields?: TaskPatch }): OpResult {
  if (typeof op.title !== 'string' || !op.title.trim()) return reject('add: title is required');
  const parsed = parsePatch(op.fields ?? {});
  if ('error' in parsed) return reject(parsed.error);
  if (parsed.patch.dependsOn) {
    const bad = depsError(q.tasks, '', parsed.patch.dependsOn);
    if (bad) return reject(bad);
  }
  return done(addTask(q, op.title, { top: op.top === true, ...parsed.patch }));
}

function applyConfigOp(q: Queue, key: ConfigKey, value: string): OpResult {
  if (!CONFIG_KEYS.includes(key)) return reject(`config: unknown key ${String(key)}`);
  if (NUMERIC_CONFIG_KEYS.includes(key)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return reject(`config: ${key} needs a positive number`);
    return done(setConfig(q, { [key]: n }));
  }
  return done(setConfig(q, { [key]: value }));
}

/**
 * Apply one validated console operation to the queue. Pure: returns the new
 * queue (plus, for `archive`, the swept tasks for the caller to persist) or a
 * rejection with the queue untouched. The single mutation gateway for every
 * console surface, so the file format and the dependency DAG stay intact.
 */
/** Reject unless the op's `id` names a task in the queue. Null when it does. */
function unknownId(q: Queue, op: { op: string; id: string }): OpResult | null {
  if (typeof op.id === 'string' && q.tasks.some(t => t.id === op.id)) return null;
  return reject(`${op.op}: unknown task id ${String(op.id ?? '')}`.trim());
}

export function applyOp(q: Queue, op: Op): OpResult {
  if (!op || typeof op !== 'object' || typeof op.op !== 'string') return reject('missing op');

  switch (op.op) {
    case 'add': return applyAdd(q, op);
    case 'start': return done(setConfig(q, { status: 'running', resumeAt: '' }));
    case 'stop': return done(setConfig(q, { status: 'stopped', resumeAt: '' }));
    case 'config': return applyConfigOp(q, op.key, op.value);
    case 'archive': {
      const swept = q.tasks.filter(t => t.status === 'done' || t.status === 'failed');
      return done({ config: q.config, tasks: q.tasks.filter(t => !swept.includes(t)) }, swept);
    }
    case 'set':
      return unknownId(q, op) ?? applyTaskPatch(q, op.id, op.fields ?? {});
    case 'remove': {
      const bad = unknownId(q, op);
      if (bad) return bad;
      const blocked = unfinishedDependents(q, op.id);
      if (blocked.length) {
        return reject(`remove: ${blocked.map(t => t.id).join(', ')} depend(s) on ${op.id} — edit their deps first`);
      }
      return done(removeTask(q, op.id));
    }
    case 'top': return unknownId(q, op) ?? done(moveToTop(q, op.id));
    case 'requeue': return unknownId(q, op) ?? done(requeueTask(q, op.id));
    case 'move': {
      const bad = unknownId(q, op);
      if (bad) return bad;
      if (!Number.isInteger(op.to) || op.to < 0) return reject('move: `to` must be a non-negative integer index');
      return done(moveTask(q, op.id, op.to));
    }
    default: return reject(`unknown op: ${(op as { op: string }).op}`);
  }
}
