// queue-model.ts — pure model for the agent work queue: parse/serialize the
// human-editable Markdown file and transform it with side-effect-free operations.
// All I/O (files, git, clock, validation) lives in queue.ts; everything here is
// deterministic and unit-tested. Time is always passed in as an ISO string.
//
// File shape (one Markdown file a human can read and edit at any time):
//
//   # Work Queue
//   <!-- queue:config
//   status: running
//   interval: 6m
//   maxFailures: 3
//   leaseMinutes: 30
//   maxParallel: 1
//   integrationBranch:
//   -->
//   - [ ] task-001 — Add hello endpoint
//     - mode: chain
//     - slug: hello-endpoint
//     - deps: task-000
//     - files: src/api/hello.ts, test/hello.test.ts
//     - validate: npm test
//     - accept: GET /hello returns 200 "hello"
//     - failures: 1
//     - note: needs-spec: which auth?
//     - owner: worker-a
//     - branch: queue/task-001
//     - worktree: .agent/queue/wt/task-001
//     - started: 2026-08-12T19:40:00.000Z
//
// Line order is priority (top first). Checkboxes encode status:
//   `[ ]` pending · `[>]` active · `[x]` done · `[!]` failed.
//
// quality-ok: file-length — one cohesive work-queue model read top-to-bottom
// (types → parse → serialize → mutations → selection over a single Task/Queue
// type). Kept whole by choice at ~500 lines rather than fragmenting one model
// across files with circular type imports just to satisfy a line-count proxy.

// ---------------------------------------------------------------- model

export type TaskStatus = 'pending' | 'active' | 'done' | 'failed';
export type TaskMode = 'direct' | 'chain';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  mode: TaskMode;
  held: boolean;
  /** Cumulative agent seconds banked across all work sessions on this task. */
  elapsedSecs: number;
  slug: string | null;
  dependsOn: string[];
  files: string[];
  validate: string | null;
  accept: string | null;
  note: string | null;
  failures: number;
  owner: string | null;
  branch: string | null;
  worktree: string | null;
  startedAt: string | null;
}

/** Fields user-facing queue editors may change. */
export const EDITABLE_TASK_FIELDS = ['title', 'mode', 'held', 'elapsed', 'slug', 'deps', 'files', 'validate', 'accept', 'note'] as const;

export interface QueueConfig {
  status: 'running' | 'stopped';
  interval: string;
  maxFailures: number;
  leaseMinutes: number;
  maxParallel: number;
  integrationBranch: string;
  /** ISO time to auto-resume a usage-limit pause; empty = not paused-until. */
  resumeAt: string;
  /** Fallback cadence the loop re-checks at when idle (nothing eligible to run). */
  idlePoll: string;
  /** Slow cadence the loop backs off to while paused (poll until the window reopens). */
  pausePoll: string;
  /**
   * Monotonic id counter: the next `task-NNN` number to hand out. Persisted so ids
   * never recycle after a task is archived/removed — once `task-007` has existed, no
   * later task reuses that id, even when the queue drains to empty.
   */
  nextId: number;
}

export interface Queue {
  config: QueueConfig;
  tasks: Task[];
}

export const DEFAULT_CONFIG: QueueConfig = {
  status: 'running',
  interval: '6m',
  maxFailures: 3,
  // quality-ok: magic-number — default lease is 30 minutes before a crashed worker is reclaimed
  leaseMinutes: 30,
  maxParallel: 1,
  integrationBranch: '',
  resumeAt: '',
  idlePoll: '20m',
  pausePoll: '30m',
  nextId: 1,
};

const MS_PER_MIN = 60000;
const ID_PAD = 3;

const MARK: Record<TaskStatus, string> = { pending: ' ', active: '>', done: 'x', failed: '!' };
const STATUS_OF: Record<string, TaskStatus> = {
  ' ': 'pending', '': 'pending', '>': 'active', x: 'done', X: 'done', '!': 'failed',
};

/** A fresh task with all optional fields empty. */
export function newTask(id: string, title: string): Task {
  return {
    id, title, status: 'pending', mode: 'direct', held: false, elapsedSecs: 0,
    slug: null, dependsOn: [], files: [],
    validate: null, accept: null, note: null, failures: 0, owner: null, branch: null,
    worktree: null, startedAt: null,
  };
}

// ---------------------------------------------------------------- parse

const TASK_RE = /^- \[([ >xX!]?)\]\s+(.*)$/;
const FIELD_RE = /^\s+[-*]\s+(\w+):\s*(.*)$/;
const ID_TITLE_RE = /^(task-\d+)\s+[—:-]+\s+(.*)$/;

/** Split a comma-separated field value into trimmed, non-empty items. */
export function splitList(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Parse a human duration into seconds: `2h15m30s`, `90m`, `45s`, or a bare
 * number (minutes — the quick-scan unit). Forgiving: garbage parses to 0 so
 * a hand edit never breaks the file.
 */
const SECS_PER_MIN = 60;
const SECS_PER_HOUR = 3600;
const MS_PER_SEC = 1000;
export function parseDurationSecs(v: string): number {
  const s = v.trim();
  if (!s) return 0;
  let total = 0, matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*([hms])?/g)) {
    matched = true;
    const n = Number(m[1]);
    total += m[2] === 'h' ? n * SECS_PER_HOUR : m[2] === 's' ? n : n * SECS_PER_MIN;
  }
  return matched ? Math.max(0, Math.round(total)) : 0;
}

/**
 * Quick-scan display, two tiers: seconds under a minute (`45s`), whole
 * minutes above (`135m`, floored — never hours, so columns stay comparable).
 */
export function formatDurationSecs(s: number): string {
  const secs = Math.max(0, Math.round(s));
  return secs < SECS_PER_MIN ? `${secs}s` : `${Math.floor(secs / SECS_PER_MIN)}m`;
}

/**
 * Exact serializer: every nonzero unit survives the round-trip (`2h15m30s`),
 * so worker rewrites never bleed precision the display chose to hide.
 */
export function formatDurationExact(s: number): string {
  let secs = Math.max(0, Math.round(s));
  const h = Math.floor(secs / SECS_PER_HOUR); secs -= h * SECS_PER_HOUR;
  const m = Math.floor(secs / SECS_PER_MIN); secs -= m * SECS_PER_MIN;
  return (h ? `${h}h` : '') + (m ? `${m}m` : '') + (secs ? `${secs}s` : '') || '0s';
}

/**
 * The banking rule, one home: ending a session adds now−startedAt (floored
 * at zero for missing leases and clock skew) to the running total.
 */
export function bankSession(t: Task, nowIso: string): number {
  if (!t.startedAt) return t.elapsedSecs;
  const delta = Math.floor((Date.parse(nowIso) - Date.parse(t.startedAt)) / MS_PER_SEC);
  return t.elapsedSecs + Math.max(0, delta);
}

function applyConfig(config: QueueConfig, key: string, val: string): void {
  switch (key) {
    case 'status': config.status = val === 'stopped' ? 'stopped' : 'running'; break;
    case 'interval': config.interval = val; break;
    case 'maxFailures': config.maxFailures = Number(val) || DEFAULT_CONFIG.maxFailures; break;
    case 'leaseMinutes': config.leaseMinutes = Number(val) || DEFAULT_CONFIG.leaseMinutes; break;
    case 'maxParallel': config.maxParallel = Math.max(1, Number(val) || 1); break;
    case 'integrationBranch': config.integrationBranch = val; break;
    case 'resumeAt': config.resumeAt = val; break;
    case 'idlePoll': config.idlePoll = val || DEFAULT_CONFIG.idlePoll; break;
    case 'pausePoll': config.pausePoll = val || DEFAULT_CONFIG.pausePoll; break;
    case 'nextId': config.nextId = Math.max(1, Number(val) || 1); break;
    default: break;
  }
}

/**
 * The canonical wire→model coercion for one task field: a raw string (file
 * line, CLI flag, or console op) becomes a typed partial. Every surface that
 * accepts field text derives from this one grammar; unknown keys coerce to {}
 * so callers decide whether that is an error (the console rejects, the file
 * parser forgives).
 */
export function fieldPatch(key: string, val: string): Partial<Task> {
  const v = val.trim();
  switch (key) {
    case 'title': return v ? { title: v } : {};
    case 'mode': return { mode: v === 'chain' ? 'chain' : 'direct' };
    case 'held': return { held: v === 'true' };
    case 'elapsed': return { elapsedSecs: parseDurationSecs(v) };
    case 'slug': return { slug: v || null };
    case 'deps': case 'dependsOn': return { dependsOn: splitList(v) };
    case 'files': return { files: splitList(v) };
    case 'validate': return { validate: v || null };
    case 'accept': return { accept: v || null };
    case 'note': return { note: v || null };
    case 'failures': return { failures: Number(v) || 0 };
    case 'owner': return { owner: v || null };
    case 'branch': return { branch: v || null };
    case 'worktree': return { worktree: v || null };
    case 'started': case 'startedAt': return { startedAt: v || null };
    default: return {};
  }
}

function applyField(task: Task, key: string, val: string): void {
  Object.assign(task, fieldPatch(key, val));
}

/** Parse the Markdown queue file into a model. Forgiving of hand edits. */
export function parseQueue(md: string): Queue {
  const config: QueueConfig = { ...DEFAULT_CONFIG };
  const cfgBlock = md.match(/<!--\s*queue:config([\s\S]*?)-->/);
  if (cfgBlock) {
    for (const line of cfgBlock[1].split('\n')) {
      const kv = line.match(/^\s*(\w+)\s*:\s*(.*?)\s*$/);
      if (kv) applyConfig(config, kv[1], kv[2]);
    }
  }

  const tasks: Task[] = [];
  for (const line of md.split('\n')) {
    const t = line.match(TASK_RE);
    if (t) {
      const rest = t[2].trim();
      const idm = rest.match(ID_TITLE_RE);
      const task = idm ? newTask(idm[1], idm[2].trim()) : newTask('', rest);
      task.status = STATUS_OF[t[1]] ?? 'pending';
      tasks.push(task);
      continue;
    }
    const f = line.match(FIELD_RE);
    if (f && tasks.length) applyField(tasks[tasks.length - 1], f[1], f[2].trim());
  }
  return { config, tasks };
}

// ---------------------------------------------------------------- serialize

/** The highest `task-NNN` number currently present (0 if none). */
function maxIdNum(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) {
    const n = Number(t.id.match(/^task-(\d+)$/)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max;
}

function fmtId(n: number): string {
  return `task-${String(n).padStart(ID_PAD, '0')}`;
}

/**
 * The next id number to hand out: the monotonic counter, never below the highest id
 * already present (so a hand-typed high id can't collide, and the counter never goes
 * backwards even if it was dropped from an old file).
 */
function nextIdNum(q: Queue): number {
  return Math.max(q.config.nextId, maxIdNum(q.tasks) + 1);
}

/**
 * Assign monotonic ids to any id-less (hand-added) tasks, advancing the persisted
 * counter so those ids never recycle either. Returns the id-complete task list and
 * the counter value to persist.
 */
function assignIds(q: Queue): { tasks: Task[]; nextId: number } {
  let n = nextIdNum(q);
  const tasks = q.tasks.map(t => (t.id ? t : { ...t, id: fmtId(n++) }));
  return { tasks, nextId: Math.max(n, maxIdNum(tasks) + 1) };
}

/**
 * A task's spec fields as ordered `[label, value]` pairs, in canonical order, empty
 * ones omitted. The single source of field order/labels/guards that both the file
 * serializer (`fieldLines`) and the CLI `show` view derive from, so adding a field
 * touches one place. `alwaysMode` forces the `mode` line even for the default
 * `direct` — the `show` view lists it explicitly; the serialized file omits the
 * default to stay terse.
 */
export function taskFields(t: Task, alwaysMode = false): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (alwaysMode || t.mode !== 'direct') pairs.push(['mode', t.mode]);
  if (t.held) pairs.push(['held', 'true']);
  const push = (k: string, v: string): void => { if (v) pairs.push([k, v]); };
  push('slug', t.slug ?? '');
  push('deps', t.dependsOn.join(', '));
  push('files', t.files.join(', '));
  push('validate', t.validate ?? '');
  push('accept', t.accept ?? '');
  push('failures', t.failures ? String(t.failures) : '');
  if (t.elapsedSecs) pairs.push(['elapsed', formatDurationExact(t.elapsedSecs)]);
  push('note', t.note ?? '');
  push('owner', t.owner ?? '');
  push('branch', t.branch ?? '');
  push('worktree', t.worktree ?? '');
  push('started', t.startedAt ?? '');
  return pairs;
}

function fieldLines(t: Task): string[] {
  return taskFields(t).map(([k, v]) => `  - ${k}: ${v}`);
}

const HEADER = [
  'Order = priority (top first). Checkboxes: `[ ]` pending · `[>]` active · '
    + '`[x]` done · `[!]` failed.',
  'Edit this file freely to reprioritize, add, or remove work; the worker reads '
    + 'it every tick. Task lines and their indented fields survive; freeform prose '
    + 'is not preserved across worker writes.',
];

/** Render the model back to the canonical Markdown file. */
export function serializeQueue(q: Queue): string {
  const c = q.config;
  const { tasks, nextId } = assignIds(q);
  const lines = [
    '# Work Queue', '',
    '<!-- queue:config',
    `status: ${c.status}`,
    `interval: ${c.interval}`,
    `maxFailures: ${c.maxFailures}`,
    `leaseMinutes: ${c.leaseMinutes}`,
    `maxParallel: ${c.maxParallel}`,
    `integrationBranch: ${c.integrationBranch}`,
    `resumeAt: ${c.resumeAt}`,
    `idlePoll: ${c.idlePoll}`,
    `pausePoll: ${c.pausePoll}`,
    `nextId: ${nextId}`,
    '-->', '',
    ...HEADER, '',
  ];
  for (const t of tasks) {
    lines.push(`- [${MARK[t.status]}] ${t.id} — ${t.title}`, ...fieldLines(t));
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------- pure ops

function withTasks(q: Queue, tasks: Task[]): Queue {
  return { config: q.config, tasks };
}

function mapTask(q: Queue, id: string, fn: (t: Task) => Task): Queue {
  return withTasks(q, q.tasks.map(t => (t.id === id ? fn(t) : t)));
}

export function addTask(q: Queue, title: string, opts: { top?: boolean } & Partial<Task> = {}): Queue {
  const { top, ...over } = opts;
  const n = nextIdNum(q);
  const task: Task = { ...newTask(fmtId(n), title.trim()), ...over };
  const config = { ...q.config, nextId: n + 1 };
  return { config, tasks: top ? [task, ...q.tasks] : [...q.tasks, task] };
}

/** Bulk-add plain-title tasks — the "create a queue from in-memory items" path. */
export function addMany(q: Queue, titles: string[], opts: { top?: boolean } = {}): Queue {
  let n = nextIdNum(q);
  const fresh = titles.map(s => s.trim()).filter(Boolean).map(title => newTask(fmtId(n++), title));
  const config = { ...q.config, nextId: n };
  return { config, tasks: opts.top ? [...fresh, ...q.tasks] : [...q.tasks, ...fresh] };
}

export function setTaskStatus(q: Queue, id: string, status: TaskStatus): Queue {
  return mapTask(q, id, t => ({ ...t, status }));
}

export function setField(q: Queue, id: string, patch: Partial<Task>): Queue {
  return mapTask(q, id, t => ({ ...t, ...patch }));
}

export function moveToTop(q: Queue, id: string): Queue {
  return moveTask(q, id, 0);
}

/** Editable config keys, split by type — the one home both CLI and console derive from. */
export const NUMERIC_CONFIG_KEYS = ['maxFailures', 'leaseMinutes', 'maxParallel'] as const;
export const TEXT_CONFIG_KEYS = ['interval', 'integrationBranch', 'idlePoll', 'pausePoll'] as const;

/** Reorder a task to an explicit 0-based position, clamped to the list bounds. */
export function moveTask(q: Queue, id: string, toIndex: number): Queue {
  const hit = q.tasks.find(t => t.id === id);
  if (!hit) return q;
  const rest = q.tasks.filter(t => t.id !== id);
  const at = Math.min(Math.max(toIndex, 0), rest.length);
  return withTasks(q, [...rest.slice(0, at), hit, ...rest.slice(at)]);
}

export function removeTask(q: Queue, id: string): Queue {
  return withTasks(q, q.tasks.filter(t => t.id !== id));
}

export function setConfig(q: Queue, patch: Partial<QueueConfig>): Queue {
  return { config: { ...q.config, ...patch }, tasks: q.tasks };
}

/** Mark a task active and claim it for a worker, stamping the lease clock. */
export function beginTask(q: Queue, id: string, nowIso: string, owner: string | null = null): Queue {
  return mapTask(q, id, t => ({ ...t, status: 'active', owner, startedAt: nowIso }));
}

export function markDone(q: Queue, id: string, nowIso: string): Queue {
  return mapTask(q, id, t => ({
    ...t, status: 'done', owner: null, worktree: null, startedAt: null,
    elapsedSecs: bankSession(t, nowIso),
  }));
}

/**
 * Record a failure. The task retries (moved to the back of the line, still
 * pending) until it reaches maxFailures, then goes terminal `failed`. Either way
 * its worktree/owner are released. Returns the new queue plus whether it went
 * terminal and the running failure count.
 */
export function recordFailure(
  q: Queue, id: string, reason: string | null, maxFailures: number, nowIso: string,
): { queue: Queue; terminal: boolean; failures: number } {
  const task = q.tasks.find(t => t.id === id);
  if (!task) return { queue: q, terminal: false, failures: 0 };
  const failures = task.failures + 1;
  const terminal = failures >= maxFailures;
  const updated: Task = {
    ...task, failures, note: reason ?? task.note,
    status: terminal ? 'failed' : 'pending', owner: null, worktree: null, startedAt: null,
    elapsedSecs: bankSession(task, nowIso),
  };
  const rest = q.tasks.filter(t => t.id !== id);
  // terminal keeps position; a retry drops to the back so other work proceeds first.
  const tasks = terminal ? q.tasks.map(t => (t.id === id ? updated : t)) : [...rest, updated];
  return { queue: withTasks(q, tasks), terminal, failures };
}

/**
 * Revive a failed (or retrying) task in place: back to pending with its failure
 * history cleared, position kept. The recovery verb for "I fixed the spec, run it
 * again." An active task is never reset — stealing a live claim would let two
 * workers run it at once; clean pending/done tasks and unknown ids are also
 * left untouched.
 */
export function requeueTask(q: Queue, id: string): Queue {
  const hit = q.tasks.find(t => t.id === id);
  if (!hit || hit.status === 'active' || (hit.status !== 'failed' && hit.failures === 0)) return q;
  return mapTask(q, id, t => ({
    ...t, status: 'pending', failures: 0, note: null, owner: null, startedAt: null,
  }));
}

/**
 * Operator release of a lane: an active task goes back to pending with its
 * lease cleared, position kept. The explicit-steer counterpart to `claim` —
 * used by board drag-back. Anything not active (or unknown) is untouched.
 */
export function unclaimTask(q: Queue, id: string, nowIso: string): Queue {
  const hit = q.tasks.find(t => t.id === id);
  if (!hit || hit.status !== 'active') return q;
  return mapTask(q, id, t => ({
    ...t, status: 'pending', owner: null, startedAt: null, elapsedSecs: bankSession(t, nowIso),
  }));
}

/**
 * Park or unpark a task: held tasks stay pending but are never eligible, so
 * the drain skips them with no fake dependency edits. Position and spec kept.
 */
export function holdTask(q: Queue, id: string, held: boolean): Queue {
  return mapTask(q, id, t => ({ ...t, held }));
}

/**
 * Operator terminal-fail: any unfinished task goes `failed` in place with the
 * operator's note, lease cleared. The board's "drag to Failed" — explicit,
 * immediate, and audited — versus `recordFailure`'s retry counting.
 */
export function forceFail(q: Queue, id: string, reason: string, nowIso: string): Queue {
  return mapTask(q, id, t => (t.status === 'done' || t.status === 'failed'
    ? t
    : {
      ...t, status: 'failed', note: reason, owner: null, worktree: null, startedAt: null,
      elapsedSecs: bankSession(t, nowIso),
    }));
}

/**
 * Reopen a finished task to pending, position kept. The board's "drag out of
 * Done" — the operator's explicit steer; dependents re-resolve on next tick.
 */
export function reopenTask(q: Queue, id: string): Queue {
  const hit = q.tasks.find(t => t.id === id);
  if (!hit || hit.status !== 'done') return q;
  return mapTask(q, id, t => ({ ...t, status: 'pending' }));
}

/** Pause the queue until an ISO time, to ride out a usage-limit window. */
export function pauseUntil(q: Queue, resumeAtIso: string): Queue {
  return setConfig(q, { status: 'stopped', resumeAt: resumeAtIso });
}

/**
 * If the queue is paused-until and that time has arrived, resume it (clearing
 * resumeAt). A plain manual stop (no resumeAt) is left untouched.
 */
export function resumeIfDue(q: Queue, nowIso: string): { queue: Queue; resumed: boolean } {
  const { status, resumeAt } = q.config;
  if (status === 'stopped' && resumeAt && Date.parse(nowIso) >= Date.parse(resumeAt)) {
    return { queue: setConfig(q, { status: 'running', resumeAt: '' }), resumed: true };
  }
  return { queue: q, resumed: false };
}

function ageMinutes(fromIso: string | null, nowIso: string): number {
  if (!fromIso) return 0;
  return (Date.parse(nowIso) - Date.parse(fromIso)) / MS_PER_MIN;
}

/** Expired leases identify ownership conflicts; they never authorize releasing claims. */
export function staleLeases(
  q: Queue, nowIso: string, leaseMinutes: number,
): Task[] {
  return q.tasks.filter(t => t.status === 'active' && ageMinutes(t.startedAt, nowIso) >= leaseMinutes);
}

// ---------------------------------------------------------------- rendering

const BADGE: Record<TaskStatus, string> = { pending: '·', active: '▶', done: '✓', failed: '✗' };

/** A compact, human-readable listing (used by `queue list`). */
export function render(q: Queue): string {
  const c = q.config;
  const counts = (s: TaskStatus): number => q.tasks.filter(t => t.status === s).length;
  const head = `Work Queue — ${c.status} · every ${c.interval} · parallel ${c.maxParallel} · `
    + `${counts('pending')} pending, ${counts('active')} active, ${counts('done')} done, `
    + `${counts('failed')} failed`;
  if (!q.tasks.length) return `${head}\n  (empty)`;
  const rows = assignIds(q).tasks.map((t, i) => {
    const tags = [
      t.mode === 'chain' ? 'chain' : '',
      t.elapsedSecs ? `⏱${formatDurationSecs(t.elapsedSecs)}` : '',
      t.dependsOn.length ? `deps:${t.dependsOn.join('+')}` : '',
      t.failures ? `retries:${t.failures}` : '',
      t.owner ? `@${t.owner}` : '',
    ].filter(Boolean).join(' ');
    return `  ${i + 1}. ${BADGE[t.status]} ${t.id}  ${t.title}${tags ? `   [${tags}]` : ''}`;
  });
  return `${head}\n${rows.join('\n')}`;
}

// ---------------------------------------------------------------- selection

/**
 * The set of task ids `id` transitively depends on (its ancestors in the dep
 * DAG). Used by `gateTasks` to never add a gate dep to a task the gate itself
 * already depends on — that would close a cycle and deadlock both.
 */
function dependencyClosure(q: Queue, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const task = q.tasks.find(t => t.id === cur);
    if (!task) continue;
    for (const d of task.dependsOn) {
      if (!seen.has(d)) { seen.add(d); stack.push(d); }
    }
  }
  return seen;
}

/**
 * Apply a dependency gate: add `gateId` to the deps of every OTHER unfinished
 * task so nothing runs until the gate task is done. This is the mechanical form
 * of a temporary priority block (e.g. the 2026 model-fidelity block, where every
 * non-model task carried `deps: task-591`) — never hand-edit deps to do this.
 *
 * Idempotent and cycle-safe. A task is skipped when it: is the gate itself; is
 * already `done`/`failed` (a finished task can't be blocked); already lists the
 * gate in its deps; is an ancestor the gate transitively depends on (adding the
 * dep would close a cycle); or, when `only` is given, does not match that
 * case-insensitive substring against its id or title. Returns the new queue and
 * the ids actually gated (empty when the gate task doesn't exist).
 */
export function gateTasks(
  q: Queue, gateId: string, only?: string,
): { queue: Queue; gated: string[] } {
  if (!q.tasks.some(t => t.id === gateId)) return { queue: q, gated: [] };
  const ancestors = dependencyClosure(q, gateId);
  const needle = only?.trim().toLowerCase() ?? '';
  const gated: string[] = [];
  const tasks = q.tasks.map(t => {
    if (t.id === gateId) return t;
    if (t.status === 'done' || t.status === 'failed') return t;
    if (t.dependsOn.includes(gateId)) return t;
    if (ancestors.has(t.id)) return t;
    if (needle && !`${t.id} ${t.title}`.toLowerCase().includes(needle)) return t;
    gated.push(t.id);
    return { ...t, dependsOn: [...t.dependsOn, gateId] };
  });
  return { queue: withTasks(q, tasks), gated };
}

/**
 * Lift a dependency gate: strip `gateId` from every task's deps (trimming a
 * multi-dep list, dropping an empty one). The inverse of `gateTasks` — the
 * mechanical way to open a block like the model-fidelity gate rather than
 * text-editing `queue.md`. Returns the new queue and the ids actually ungated.
 * The gate task itself is untouched here; the CLI marks it done separately.
 */
export function ungateTasks(q: Queue, gateId: string): { queue: Queue; ungated: string[] } {
  const ungated: string[] = [];
  const tasks = q.tasks.map(t => {
    if (!t.dependsOn.includes(gateId)) return t;
    ungated.push(t.id);
    return { ...t, dependsOn: t.dependsOn.filter(d => d !== gateId) };
  });
  return { queue: withTasks(q, tasks), ungated };
}

/** A pending task is eligible only when it isn't held and every dependency is done. */
export function isEligible(task: Task, q: Queue): boolean {
  return task.status === 'pending' && !task.held
    && task.dependsOn.every(d => q.tasks.find(x => x.id === d)?.status === 'done');
}

/** Pending tasks blocked by a dependency that failed (can never become eligible). */
export function deadlocked(q: Queue): Task[] {
  return q.tasks.filter(t => t.status === 'pending'
    && t.dependsOn.some(d => q.tasks.find(x => x.id === d)?.status === 'failed'));
}

/**
 * Completed (`done`) tasks that may be archived out of the live queue right now.
 * `isEligible` resolves a task's `deps` against the *live* queue, so a done task is
 * still needed while any unfinished (pending/active) task depends on it — archiving
 * it early would deadlock that dependent. So a done task is archivable only once no
 * unfinished task lists it as a dependency; a chain therefore archives from the
 * leaves inward as each dependent finishes. Failed tasks are never returned — they
 * stay visible so `deadlocked()` can still report dependents blocked by a failed
 * dependency (sweep them explicitly with `queue archive`).
 */
export function archivableDone(q: Queue): Task[] {
  const neededByUnfinished = new Set<string>();
  for (const t of q.tasks) {
    if (t.status === 'pending' || t.status === 'active') {
      for (const d of t.dependsOn) neededByUnfinished.add(d);
    }
  }
  return q.tasks.filter(t => t.status === 'done' && !neededByUnfinished.has(t.id));
}

/**
 * The manual archive sweep: terminal `failed` tasks plus every archivable
 * `done` task leave the live queue. A done task that unfinished work still
 * depends on is NOT swept (`archivableDone`) — archiving it would strand its
 * dependents as permanently ineligible with nothing left to flag the gap.
 * Returns the shrunken queue and the swept tasks for the caller to persist.
 */
export function sweepFinished(q: Queue): { queue: Queue; swept: Task[] } {
  const gone = new Set([
    ...q.tasks.filter(t => t.status === 'failed').map(t => t.id),
    ...archivableDone(q).map(t => t.id),
  ]);
  return {
    queue: withTasks(q, q.tasks.filter(t => !gone.has(t.id))),
    swept: q.tasks.filter(t => gone.has(t.id)),
  };
}

/**
 * The single task a serial worker should act on now: resume an active task if one
 * exists, else the topmost eligible pending task. Null if stopped or drained.
 */
export function nextActionable(q: Queue): Task | null {
  if (q.config.status === 'stopped') return null;
  return q.tasks.find(t => t.status === 'active')
    ?? q.tasks.find(t => isEligible(t, q))
    ?? null;
}

/**
 * The set of tasks a fan-out dispatcher may START right now: eligible pending
 * tasks, topmost first, capped so active + started ≤ maxParallel. Empty when
 * stopped or at capacity.
 */
export function readyTasks(q: Queue): Task[] {
  if (q.config.status === 'stopped') return [];
  const active = q.tasks.filter(t => t.status === 'active').length;
  const slots = Math.max(0, q.config.maxParallel - active);
  return q.tasks.filter(t => isEligible(t, q)).slice(0, slots);
}

/** Stable prefix a Monitor / cron / agent keys on to (re)start a stalled drain. */
export const DRAIN_MARKER = 'queue: DRAIN-WANTED';

/**
 * The machine signal that a running queue has drainable work but no driver
 * attached — the invariant "non-empty + running ⇒ a driver is attached" made
 * observable. Returns a stable `queue: DRAIN-WANTED <n> pending` marker when the
 * queue is running, no task is active (nothing is currently draining), and at
 * least one pending task is eligible to run now; `null` otherwise (stopped, a
 * driver already active, or nothing eligible — dep-blocked/empty is genuinely
 * idle). Emitted on any mutation that can leave a running queue drainable, so a
 * later add/reprioritize re-attaches a driver instead of stalling until idlePoll.
 */
export function drainSignal(q: Queue): string | null {
  if (q.config.status !== 'running') return null;
  if (q.tasks.some(t => t.status === 'active')) return null;
  const ready = q.tasks.filter(t => isEligible(t, q)).length;
  return ready ? `${DRAIN_MARKER} ${ready} pending` : null;
}
