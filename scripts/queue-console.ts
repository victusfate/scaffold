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
//
// Bottom half: the console server — a zero-dependency loopback HTTP server
// (mermaid-watch.ts pattern) serving the page, the state JSON, the op
// endpoint, and an SSE channel that fires when the queue file changes.
// Usage: node scripts/queue-console.ts [--port 8722]   (QUEUE_FILE honored)

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, log, appendArchive, queueFile, withLock } from './queue-io.ts';
import { createSseChannel, watchFileChanges } from './sse-watch.ts';
import {
  addTask, setField, removeTask, moveToTop, moveTask, requeueTask, setConfig,
  isEligible, deadlocked, drainSignal, EDITABLE_TASK_FIELDS, fieldPatch, sweepFinished,
  NUMERIC_CONFIG_KEYS, TEXT_CONFIG_KEYS,
  type Queue, type QueueConfig, type Task,
} from './queue-model.ts';

// ---------------------------------------------------------------- contracts

export interface TaskPatch {
  title?: string; mode?: string; slug?: string; deps?: string;
  files?: string; validate?: string; accept?: string; note?: string;
}

const CONFIG_KEYS = [...NUMERIC_CONFIG_KEYS, ...TEXT_CONFIG_KEYS];
export type ConfigKey = typeof CONFIG_KEYS[number];

export type Op =
  | { op: 'add'; title: string; top?: boolean; fields?: TaskPatch }
  | { op: 'set'; id: string; fields: TaskPatch }
  | { op: 'remove' | 'top' | 'requeue'; id: string }
  | { op: 'move'; id: string; to: number }
  | { op: 'start' | 'stop' | 'archive' | 'reassign' }
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

const PATCHABLE = EDITABLE_TASK_FIELDS;

/**
 * Convert a wire TaskPatch (all strings) into a model patch, or name the bad
 * field. Boundary checks live here; the coercion itself is the model's
 * canonical `fieldPatch` grammar.
 */
function parsePatch(fields: TaskPatch): { patch: Partial<Task> } | { error: string } {
  const unknown = Object.keys(fields).find(k => !(PATCHABLE as readonly string[]).includes(k));
  if (unknown) return { error: `unknown field: ${unknown}` };
  const patch: Partial<Task> = {};
  if (fields.title !== undefined) {
    if (!fields.title.trim()) return { error: 'title cannot be empty' };
    patch.title = fields.title.trim();
  }
  for (const key of PATCHABLE) {
    const val = fields[key];
    if (key !== 'title' && val !== undefined) Object.assign(patch, fieldPatch(key, val));
  }
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

const ok = (queue: Queue, archived: Task[] = []): OpResult => ({ ok: true, queue, archived });
const reject = (error: string): OpResult => ({ ok: false, error });

function applyTaskPatch(q: Queue, id: string, fields: TaskPatch): OpResult {
  const parsed = parsePatch(fields);
  if ('error' in parsed) return reject(parsed.error);
  if (parsed.patch.dependsOn) {
    const bad = depsError(q.tasks, id, parsed.patch.dependsOn);
    if (bad) return reject(bad);
  }
  return ok(setField(q, id, parsed.patch));
}

function applyAdd(q: Queue, op: { title: string; top?: boolean; fields?: TaskPatch }): OpResult {
  if (typeof op.title !== 'string' || !op.title.trim()) return reject('add: title is required');
  const parsed = parsePatch(op.fields ?? {});
  if ('error' in parsed) return reject(parsed.error);
  if (parsed.patch.dependsOn) {
    const bad = depsError(q.tasks, '', parsed.patch.dependsOn);
    if (bad) return reject(bad);
  }
  return ok(addTask(q, op.title, { top: op.top === true, ...parsed.patch }));
}

function applyConfigOp(q: Queue, key: ConfigKey, value: string): OpResult {
  if (!CONFIG_KEYS.includes(key)) return reject(`config: unknown key ${String(key)}`);
  if ((NUMERIC_CONFIG_KEYS as readonly string[]).includes(key)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return reject(`config: ${key} needs a positive number`);
    return ok(setConfig(q, { [key]: n }));
  }
  return ok(setConfig(q, { [key]: value }));
}

/** Reject unless the op's `id` names a task in the queue. Null when it does. */
function unknownId(q: Queue, op: { op: string; id: string }): OpResult | null {
  if (typeof op.id === 'string' && q.tasks.some(t => t.id === op.id)) return null;
  return reject(`${op.op}: unknown task id ${String(op.id ?? '')}`.trim());
}

/**
 * Apply one validated console operation to the queue. Pure: returns the new
 * queue (plus, for `archive`, the swept tasks for the caller to persist) or a
 * rejection with the queue untouched. The single mutation gateway for every
 * console surface, so the file format and the dependency DAG stay intact.
 */
export function applyOp(q: Queue, op: Op): OpResult {
  if (!op || typeof op !== 'object' || typeof op.op !== 'string') return reject('missing op');

  switch (op.op) {
    case 'add': return applyAdd(q, op);
    case 'start': return ok(setConfig(q, { status: 'running', resumeAt: '' }));
    case 'stop': return ok(setConfig(q, { status: 'stopped', resumeAt: '' }));
    case 'config': return applyConfigOp(q, op.key, op.value);
    case 'archive': {
      const { queue, swept } = sweepFinished(q);
      return ok(queue, swept);
    }
    // Reassign recomputes nothing server-side: it re-reads the file, records
    // the request in the audit log (via handleOp), and returns fresh state —
    // whose drain marker is the kick that wakes an armed Monitor/loop. Active
    // claims are never touched; the page derives the { active, next } plan
    // from the returned state. Drivers honor the new order on their next tick.
    case 'reassign': return ok(q);
    case 'set':
      return unknownId(q, op) ?? applyTaskPatch(q, op.id, op.fields ?? {});
    case 'remove': {
      const bad = unknownId(q, op);
      if (bad) return bad;
      const blocked = unfinishedDependents(q, op.id);
      if (blocked.length) {
        return reject(`remove: ${blocked.map(t => t.id).join(', ')} depend(s) on ${op.id} — edit their deps first`);
      }
      return ok(removeTask(q, op.id));
    }
    case 'top': return unknownId(q, op) ?? ok(moveToTop(q, op.id));
    case 'requeue': return unknownId(q, op) ?? ok(requeueTask(q, op.id));
    case 'move': {
      const bad = unknownId(q, op);
      if (bad) return bad;
      if (!Number.isInteger(op.to) || op.to < 0) return reject('move: `to` must be a non-negative integer index');
      return ok(moveTask(q, op.id, op.to));
    }
    default: return reject(`unknown op: ${(op as { op: string }).op}`);
  }
}

// ---------------------------------------------------------------- server

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'queue-console.template.html');
const DEFAULT_PORT = 8722;
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const WATCH_INTERVAL_MS = 500;
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Only loopback names are legitimate Hosts for this server. Anything else is a
 * DNS-rebinding attempt (a hostile page resolving its own domain to 127.0.0.1
 * to smuggle requests past the browser's same-origin policy) — refuse it.
 */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject_) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > MAX_BODY_BYTES) { req.destroy(); reject_(new Error('body too large')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject_);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * Apply one op posted by the page: parse → validate through applyOp → persist.
 * The archive sidecar is written before the queue file, matching the CLI's
 * ordering (a crash between the two duplicates an audit line rather than
 * losing a task), and every accepted op lands in the audit log. Requiring a
 * JSON content-type is a security boundary, not pedantry: it forces any
 * cross-origin browser request into a CORS preflight, which this server never
 * answers — so a hostile web page cannot fire a "simple" no-preflight POST at
 * the op endpoint.
 */
async function handleOp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Compare the MIME *essence* (before any ';param'), not a substring — a
  // header like `text/plain; application/json` is essence text/plain, which
  // browsers treat as CORS-safelisted and send without preflight.
  const essence = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (essence !== 'application/json') {
    sendJson(res, HTTP_BAD_REQUEST, { error: 'content-type must be application/json' });
    return;
  }
  let op: Op;
  try {
    op = JSON.parse(await readBody(req)) as Op;
  } catch (e) {
    sendJson(res, HTTP_BAD_REQUEST, { error: `invalid JSON body: ${(e as Error).message}` });
    return;
  }
  const result = withLock(() => {
    const applied = applyOp(load(), op);
    if (applied.ok) {
      if (applied.archived.length) appendArchive(applied.archived);
      save(applied.queue);
    }
    return applied;
  });
  if (!result.ok) { sendJson(res, HTTP_BAD_REQUEST, { error: result.error }); return; }
  log(`console ${op.op}${'id' in op ? ' ' + op.id : ''}`);
  sendJson(res, HTTP_OK, consoleState(load()));
}

/**
 * Start the console server on 127.0.0.1 — a personal steering surface, never
 * exposed beyond the machine. Every request must carry a loopback Host (see
 * LOOPBACK_HOST). SSE clients get a `changed` event whenever the queue file's
 * mtime moves (worker writes included). `close()` is overridden to also end
 * SSE clients and detach the file watcher — otherwise the held-open streams
 * and the poller would keep the process alive after a shutdown.
 */
export function startServer(port: number): http.Server {
  const sse = createSseChannel();
  const server = http.createServer((req, res) => {
    if (!LOOPBACK_HOST.test(req.headers.host ?? '')) {
      sendJson(res, HTTP_FORBIDDEN, { error: 'forbidden: loopback host required' });
    } else if (req.method === 'GET' && req.url === '/') {
      res.writeHead(HTTP_OK, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(TEMPLATE, 'utf8'));
    } else if (req.method === 'GET' && req.url === '/api/queue') {
      sendJson(res, HTTP_OK, consoleState(load()));
    } else if (req.method === 'POST' && req.url === '/api/op') {
      handleOp(req, res).catch((e: unknown) => {
        if (!res.headersSent) sendJson(res, HTTP_SERVER_ERROR, { error: (e as Error).message });
        else res.end();
      });
    } else if (req.method === 'GET' && req.url === '/events') {
      sse.attach(req, res);
    } else {
      res.writeHead(HTTP_NOT_FOUND);
      res.end();
    }
  });

  const unwatch = watchFileChanges(queueFile(), WATCH_INTERVAL_MS, () => sse.broadcast('changed'));
  const netClose = server.close.bind(server);
  server.close = (cb?: (err?: Error) => void): http.Server => {
    unwatch();
    sse.end();
    server.closeAllConnections();
    return netClose(cb);
  };

  server.listen(port, '127.0.0.1');
  return server;
}

function main(argv: string[]): void {
  let port = DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i]);
    else { process.stderr.write(`usage: node scripts/queue-console.ts [--port ${DEFAULT_PORT}]\n`); process.exit(1); }
  }
  if (!Number.isInteger(port) || port < 0) { process.stderr.write('queue-console: --port needs a number\n'); process.exit(1); }
  startServer(port).on('listening', function (this: http.Server) {
    const addr = this.address() as { port: number };
    process.stdout.write(`queue-console: http://localhost:${addr.port}  (queue ${queueFile()})\n`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
