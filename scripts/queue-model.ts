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
    id, title, status: 'pending', mode: 'direct', slug: null, dependsOn: [], files: [],
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

function applyField(task: Task, key: string, val: string): void {
  switch (key) {
    case 'mode': task.mode = val === 'chain' ? 'chain' : 'direct'; break;
    case 'slug': task.slug = val || null; break;
    case 'deps': case 'dependsOn': task.dependsOn = splitList(val); break;
    case 'files': task.files = splitList(val); break;
    case 'validate': task.validate = val || null; break;
    case 'accept': task.accept = val || null; break;
    case 'note': task.note = val || null; break;
    case 'failures': task.failures = Number(val) || 0; break;
    case 'owner': task.owner = val || null; break;
    case 'branch': task.branch = val || null; break;
    case 'worktree': task.worktree = val || null; break;
    case 'started': case 'startedAt': task.startedAt = val || null; break;
    default: break;
  }
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
  const push = (k: string, v: string): void => { if (v) pairs.push([k, v]); };
  push('slug', t.slug ?? '');
  push('deps', t.dependsOn.join(', '));
  push('files', t.files.join(', '));
  push('validate', t.validate ?? '');
  push('accept', t.accept ?? '');
  push('failures', t.failures ? String(t.failures) : '');
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
  const hit = q.tasks.find(t => t.id === id);
  return hit ? withTasks(q, [hit, ...q.tasks.filter(t => t.id !== id)]) : q;
}

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

export function markDone(q: Queue, id: string): Queue {
  return mapTask(q, id, t => ({ ...t, status: 'done', owner: null, worktree: null, startedAt: null }));
}

/**
 * Record a failure. The task retries (moved to the back of the line, still
 * pending) until it reaches maxFailures, then goes terminal `failed`. Either way
 * its worktree/owner are released. Returns the new queue plus whether it went
 * terminal and the running failure count.
 */
export function recordFailure(
  q: Queue, id: string, reason: string | null, maxFailures: number,
): { queue: Queue; terminal: boolean; failures: number } {
  const task = q.tasks.find(t => t.id === id);
  if (!task) return { queue: q, terminal: false, failures: 0 };
  const failures = task.failures + 1;
  const terminal = failures >= maxFailures;
  const updated: Task = {
    ...task, failures, note: reason ?? task.note,
    status: terminal ? 'failed' : 'pending', owner: null, worktree: null, startedAt: null,
  };
  const rest = q.tasks.filter(t => t.id !== id);
  // terminal keeps position; a retry drops to the back so other work proceeds first.
  const tasks = terminal ? q.tasks.map(t => (t.id === id ? updated : t)) : [...rest, updated];
  return { queue: withTasks(q, tasks), terminal, failures };
}

/**
 * Revive a failed (or retrying) task in place: back to pending with its failure
 * history cleared, position kept. The recovery verb for "I fixed the spec, run it
 * again." A clean pending/active/done task (or unknown id) is left untouched.
 */
export function requeueTask(q: Queue, id: string): Queue {
  const hit = q.tasks.find(t => t.id === id);
  if (!hit || (hit.status !== 'failed' && hit.failures === 0)) return q;
  return mapTask(q, id, t => ({
    ...t, status: 'pending', failures: 0, note: null, owner: null, startedAt: null,
  }));
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

/**
 * Return any active task whose lease has gone stale (worker likely crashed) to
 * pending, releasing its claim. Returns the reclaimed ids so the caller can tear
 * down orphaned worktrees.
 */
export function reclaimStale(
  q: Queue, nowIso: string, leaseMinutes: number,
): { queue: Queue; reclaimed: Task[] } {
  const reclaimed: Task[] = [];
  const tasks = q.tasks.map(t => {
    if (t.status === 'active' && ageMinutes(t.startedAt, nowIso) >= leaseMinutes) {
      reclaimed.push(t);
      return { ...t, status: 'pending' as TaskStatus, owner: null, startedAt: null,
        note: 'reclaimed stale lease' };
    }
    return t;
  });
  return { queue: withTasks(q, tasks), reclaimed };
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
      t.dependsOn.length ? `deps:${t.dependsOn.join('+')}` : '',
      t.failures ? `retries:${t.failures}` : '',
      t.owner ? `@${t.owner}` : '',
    ].filter(Boolean).join(' ');
    return `  ${i + 1}. ${BADGE[t.status]} ${t.id}  ${t.title}${tags ? `   [${tags}]` : ''}`;
  });
  return `${head}\n${rows.join('\n')}`;
}

// ---------------------------------------------------------------- selection

/** A pending task is eligible only when every dependency is done. */
export function isEligible(task: Task, q: Queue): boolean {
  return task.status === 'pending'
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
