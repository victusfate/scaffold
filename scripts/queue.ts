#!/usr/bin/env node
// queue.ts — a visible, editable Markdown work queue that loop-driven agents drain.
//
// The queue lives in a single Markdown file (default .agent/queue/queue.md) that a
// human can open and edit at any time: line order is priority (top first), and a
// checkbox encodes each task's status. This module is the reliable read/mutate
// layer so the loop never corrupts the file by hand-editing it.
//
//   node scripts/queue.ts list                 # show the queue
//   node scripts/queue.ts add "Do the thing"   # append a pending task
//   node scripts/queue.ts add-many             # seed many tasks from stdin (one per line)
//   node scripts/queue.ts tick                 # loop entry: begin/continue the current task
//   node scripts/queue.ts done <id> | fail <id>
//   node scripts/queue.ts top <id>             # reprioritize to the top
//   node scripts/queue.ts start | stop         # run/pause the worker
//   node scripts/queue.ts interval 6m          # edit the wake interval
//   node scripts/queue.ts remove <id>
//
// Checkboxes: `[ ]` pending · `[>]` active · `[x]` done · `[!]` failed.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- model

export type TaskStatus = 'pending' | 'active' | 'done' | 'failed';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface QueueConfig {
  status: 'running' | 'stopped';
  interval: string;
}

export interface Queue {
  config: QueueConfig;
  tasks: Task[];
}

const MARK: Record<TaskStatus, string> = {
  pending: ' ', active: '>', done: 'x', failed: '!',
};

const STATUS_OF: Record<string, TaskStatus> = {
  ' ': 'pending', '': 'pending', '>': 'active', x: 'done', X: 'done', '!': 'failed',
};

const DEFAULT_CONFIG: QueueConfig = { status: 'running', interval: '6m' };

// ---------------------------------------------------------------- parse

const TASK_RE = /^- \[([ >xX!]?)\]\s+(.*)$/;
const ID_TITLE_RE = /^(task-\d+)\s+[—:-]+\s+(.*)$/;

/** Parse the Markdown queue file into a model. Forgiving of hand edits. */
export function parseQueue(md: string): Queue {
  const config = { ...DEFAULT_CONFIG };
  const cfgBlock = md.match(/<!--\s*queue:config([\s\S]*?)-->/);
  if (cfgBlock) {
    for (const line of cfgBlock[1].split('\n')) {
      const kv = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
      if (!kv) continue;
      if (kv[1] === 'status') config.status = kv[2] === 'stopped' ? 'stopped' : 'running';
      else if (kv[1] === 'interval') config.interval = kv[2];
    }
  }

  const tasks: Task[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(TASK_RE);
    if (!m) continue;
    const status = STATUS_OF[m[1]] ?? 'pending';
    const rest = m[2].trim();
    const idm = rest.match(ID_TITLE_RE);
    tasks.push(idm
      ? { id: idm[1], title: idm[2].trim(), status }
      : { id: '', title: rest, status });
  }
  return { config, tasks };
}

// ---------------------------------------------------------------- serialize

function nextIdNum(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) {
    const n = Number(t.id.match(/^task-(\d+)$/)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max + 1;
}

function fmtId(n: number): string {
  return `task-${String(n).padStart(3, '0')}`;
}

/** Ensure every task has a stable id (synthesizing ids for hand-added lines). */
function withIds(tasks: Task[]): Task[] {
  let n = nextIdNum(tasks);
  return tasks.map(t => (t.id ? t : { ...t, id: fmtId(n++) }));
}

/** Render the model back to the canonical Markdown file. */
export function serializeQueue(q: Queue): string {
  const tasks = withIds(q.tasks);
  const lines = [
    '# Work Queue',
    '',
    '<!-- queue:config',
    `status: ${q.config.status}`,
    `interval: ${q.config.interval}`,
    '-->',
    '',
    'Order = priority (top first). Checkboxes: `[ ]` pending · `[>]` active · '
      + '`[x]` done · `[!]` failed.',
    'Edit this file freely to reprioritize, add, or remove work; the worker '
      + 'reads it every tick.',
    '',
    ...tasks.map(t => `- [${MARK[t.status]}] ${t.id} — ${t.title}`),
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------- pure ops

function withTasks(q: Queue, tasks: Task[]): Queue {
  return { config: q.config, tasks };
}

export function addTask(q: Queue, title: string, opts: { top?: boolean } = {}): Queue {
  const task: Task = { id: fmtId(nextIdNum(q.tasks)), title: title.trim(), status: 'pending' };
  return withTasks(q, opts.top ? [task, ...q.tasks] : [...q.tasks, task]);
}

/** Bulk-add tasks — the "create a queue from in-memory items" path. */
export function addMany(q: Queue, titles: string[], opts: { top?: boolean } = {}): Queue {
  let n = nextIdNum(q.tasks);
  const fresh: Task[] = titles
    .map(t => t.trim())
    .filter(Boolean)
    .map(title => ({ id: fmtId(n++), title, status: 'pending' as TaskStatus }));
  return withTasks(q, opts.top ? [...fresh, ...q.tasks] : [...q.tasks, ...fresh]);
}

export function setTaskStatus(q: Queue, id: string, status: TaskStatus): Queue {
  return withTasks(q, q.tasks.map(t => (t.id === id ? { ...t, status } : t)));
}

export function moveToTop(q: Queue, id: string): Queue {
  const hit = q.tasks.find(t => t.id === id);
  if (!hit) return q;
  return withTasks(q, [hit, ...q.tasks.filter(t => t.id !== id)]);
}

export function removeTask(q: Queue, id: string): Queue {
  return withTasks(q, q.tasks.filter(t => t.id !== id));
}

export function setConfig(q: Queue, patch: Partial<QueueConfig>): Queue {
  return { config: { ...q.config, ...patch }, tasks: q.tasks };
}

/**
 * The task a worker should act on now: resume the active task if one exists,
 * else the topmost pending task. Null if the queue is stopped or drained.
 */
export function nextActionable(q: Queue): Task | null {
  if (q.config.status === 'stopped') return null;
  return q.tasks.find(t => t.status === 'active')
    ?? q.tasks.find(t => t.status === 'pending')
    ?? null;
}

// ---------------------------------------------------------------- rendering

export function render(q: Queue): string {
  const badge: Record<TaskStatus, string> = {
    pending: '· ', active: '▶ ', done: '✓ ', failed: '✗ ',
  };
  const body = q.tasks.length
    ? withIds(q.tasks).map((t, i) => `  ${i + 1}. ${badge[t.status]}${t.id}  ${t.title}`).join('\n')
    : '  (empty)';
  const active = q.tasks.filter(t => t.status === 'active').length;
  const pending = q.tasks.filter(t => t.status === 'pending').length;
  return `Work Queue — ${q.config.status} · interval ${q.config.interval} · `
    + `${pending} pending, ${active} active, ${q.tasks.length} total\n${body}`;
}

// ---------------------------------------------------------------- file I/O

function resolveFile(): string {
  const env = process.env.QUEUE_FILE;
  if (env) return env;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  return join(root, '.agent', 'queue', 'queue.md');
}

function load(path: string): Queue {
  return existsSync(path) ? parseQueue(readFileSync(path, 'utf8')) : parseQueue('');
}

function save(path: string, q: Queue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeQueue(q));
}

function readStdin(): string[] {
  try {
    return readFileSync(0, 'utf8').split('\n');
  } catch {
    return [];
  }
}

/** Strip a leading Markdown bullet/checkbox so pasted lists seed cleanly. */
function cleanItem(line: string): string {
  return line.replace(/^\s*[-*]\s*(\[[ >xX!]?\]\s*)?/, '').trim();
}

// ---------------------------------------------------------------- CLI

function main(argv: string[]): number {
  const [cmd = 'list', ...rest] = argv;
  const path = resolveFile();
  const flags = new Set(rest.filter(a => a.startsWith('--')));
  const args = rest.filter(a => !a.startsWith('--'));
  const top = flags.has('--top');
  let q = load(path);

  switch (cmd) {
    case 'list': case 'status':
      console.log(render(q));
      return 0;

    case 'add': {
      const title = args.join(' ').trim();
      if (!title) { console.error('usage: queue add "<title>" [--top]'); return 1; }
      q = addTask(q, title, { top });
      save(path, q);
      console.log(`added: ${q.tasks[top ? 0 : q.tasks.length - 1].id} — ${title}`);
      return 0;
    }

    case 'add-many': {
      const items = (args.length ? args : readStdin()).map(cleanItem).filter(Boolean);
      if (!items.length) { console.error('add-many: no items (pass args or pipe lines on stdin)'); return 1; }
      q = addMany(q, items, { top });
      save(path, q);
      console.log(`added ${items.length} task(s); ${q.tasks.length} total`);
      return 0;
    }

    case 'next': {
      const t = nextActionable(q);
      console.log(q.config.status === 'stopped' ? 'queue: STOPPED'
        : t ? `next: ${t.id} — ${t.title}` : 'queue: IDLE (no pending tasks)');
      return 0;
    }

    case 'tick': {
      if (q.config.status === 'stopped') {
        console.log('queue: STOPPED — run `queue start` to resume');
        return 0;
      }
      const t = nextActionable(q);
      if (!t) { console.log('queue: IDLE — no pending tasks'); return 0; }
      if (t.status === 'pending') { q = setTaskStatus(q, t.id, 'active'); save(path, q); }
      console.log(`queue: working ${t.id}\n<queue_task id="${t.id}">\n${t.title}\n</queue_task>\n`
        + `When finished: node scripts/queue.ts done ${t.id}  (or fail ${t.id})`);
      return 0;
    }

    case 'begin': case 'done': case 'fail': {
      const id = args[0];
      const status: TaskStatus = cmd === 'begin' ? 'active' : cmd === 'done' ? 'done' : 'failed';
      if (!id || !q.tasks.some(t => t.id === id)) { console.error(`${cmd}: unknown task id`); return 1; }
      q = setTaskStatus(q, id, status);
      save(path, q);
      console.log(`${id} → ${status}`);
      return 0;
    }

    case 'top': case 'prioritize': {
      const id = args[0];
      if (!id || !q.tasks.some(t => t.id === id)) { console.error('top: unknown task id'); return 1; }
      save(path, moveToTop(q, id));
      console.log(`${id} moved to top`);
      return 0;
    }

    case 'remove': case 'rm': {
      const id = args[0];
      if (!id || !q.tasks.some(t => t.id === id)) { console.error('remove: unknown task id'); return 1; }
      save(path, removeTask(q, id));
      console.log(`removed ${id}`);
      return 0;
    }

    case 'start': case 'stop': {
      save(path, setConfig(q, { status: cmd === 'start' ? 'running' : 'stopped' }));
      console.log(`queue: ${cmd === 'start' ? 'running' : 'stopped'}`);
      return 0;
    }

    case 'interval': {
      if (!args[0]) { console.error('usage: queue interval <duration, e.g. 6m>'); return 1; }
      save(path, setConfig(q, { interval: args[0] }));
      console.log(`interval: ${args[0]}`);
      return 0;
    }

    default:
      console.error(`unknown command: ${cmd}\n`
        + 'commands: list add add-many next tick begin done fail top remove start stop interval');
      return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
