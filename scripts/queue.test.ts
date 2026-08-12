#!/usr/bin/env node
// Tests for scripts/queue.ts — Markdown work-queue engine (parse/serialize/ops).

import {
  parseQueue,
  serializeQueue,
  addTask,
  addMany,
  setTaskStatus,
  moveToTop,
  removeTask,
  setConfig,
  nextActionable,
  type Queue,
} from './queue.ts';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const SAMPLE = `# Work Queue

<!-- queue:config
status: running
interval: 6m
-->

Order = priority (top first). Checkboxes: \`[ ]\` pending · \`[>]\` active · \`[x]\` done · \`[!]\` failed.

- [ ] task-001 — Add telemetry interface
- [>] task-002 — Refactor the parser
- [x] task-003 — Fix the login bug
- [!] task-004 — Broken migration
`;

// ---- parse ----
{
  const q = parseQueue(SAMPLE);
  assert('parse config status', q.config.status === 'running', q.config.status);
  assert('parse config interval', q.config.interval === '6m', q.config.interval);
  assert('parse task count', q.tasks.length === 4, String(q.tasks.length));
  assert('parse pending', q.tasks[0].status === 'pending' && q.tasks[0].id === 'task-001');
  assert('parse active', q.tasks[1].status === 'active');
  assert('parse done', q.tasks[2].status === 'done');
  assert('parse failed', q.tasks[3].status === 'failed');
  assert('parse title', q.tasks[0].title === 'Add telemetry interface', q.tasks[0].title);
}

// ---- round-trip: parse(serialize(parse(x))) is stable ----
{
  const q1 = parseQueue(SAMPLE);
  const q2 = parseQueue(serializeQueue(q1));
  assert('round-trip config', JSON.stringify(q1.config) === JSON.stringify(q2.config));
  assert('round-trip tasks', JSON.stringify(q1.tasks) === JSON.stringify(q2.tasks),
    JSON.stringify(q2.tasks));
}

// ---- forgiving parse: bare line with no id/status gets defaults + synthesized id ----
{
  const q = parseQueue('- [ ] just do the thing\n');
  assert('bare line parsed', q.tasks.length === 1 && q.tasks[0].title === 'just do the thing');
  const id = serializeQueue(q).match(/task-\d+/);
  assert('bare line gets id on serialize', id !== null, serializeQueue(q));
}

// ---- empty / missing file defaults ----
{
  const q = parseQueue('');
  assert('empty defaults running', q.config.status === 'running');
  assert('empty no tasks', q.tasks.length === 0);
}

// ---- addTask ----
{
  const q = parseQueue(SAMPLE);
  const q2 = addTask(q, 'A new task');
  assert('addTask appends', q2.tasks.length === 5 && q2.tasks[4].title === 'A new task');
  assert('addTask fresh id', q2.tasks[4].id === 'task-005', q2.tasks[4].id);
  assert('addTask pending', q2.tasks[4].status === 'pending');
  const q3 = addTask(q, 'Urgent', { top: true });
  assert('addTask --top prepends', q3.tasks[0].title === 'Urgent');
  assert('addTask immutable', q.tasks.length === 4);
}

// ---- addMany (create-from-memory path) ----
{
  const q = parseQueue('');
  const q2 = addMany(q, ['first', 'second', 'third']);
  assert('addMany count', q2.tasks.length === 3);
  assert('addMany order', q2.tasks[0].title === 'first' && q2.tasks[2].title === 'third');
  assert('addMany ids', q2.tasks[0].id === 'task-001' && q2.tasks[2].id === 'task-003');
  // extends an existing queue rather than clobbering
  const q3 = addMany(parseQueue(SAMPLE), ['extra']);
  assert('addMany extends', q3.tasks.length === 5 && q3.tasks[4].title === 'extra');
}

// ---- setTaskStatus ----
{
  const q = parseQueue(SAMPLE);
  const q2 = setTaskStatus(q, 'task-001', 'done');
  assert('setTaskStatus', q2.tasks[0].status === 'done');
  assert('setTaskStatus immutable', q.tasks[0].status === 'pending');
}

// ---- moveToTop (prioritize) ----
{
  const q = parseQueue(SAMPLE);
  const q2 = moveToTop(q, 'task-004');
  assert('moveToTop', q2.tasks[0].id === 'task-004');
  assert('moveToTop preserves count', q2.tasks.length === 4);
}

// ---- removeTask ----
{
  const q = parseQueue(SAMPLE);
  const q2 = removeTask(q, 'task-002');
  assert('removeTask', q2.tasks.length === 3 && !q2.tasks.some(t => t.id === 'task-002'));
}

// ---- setConfig ----
{
  const q = parseQueue(SAMPLE);
  assert('setConfig stop', setConfig(q, { status: 'stopped' }).config.status === 'stopped');
  assert('setConfig interval', setConfig(q, { interval: '10m' }).config.interval === '10m');
}

// ---- nextActionable ----
{
  // active task is resumed before any pending
  const q = parseQueue(SAMPLE);
  assert('next resumes active', nextActionable(q)?.id === 'task-002', nextActionable(q)?.id);

  // no active → first pending (topmost)
  const q2: Queue = setTaskStatus(q, 'task-002', 'done');
  assert('next picks first pending', nextActionable(q2)?.id === 'task-001');

  // stopped → null
  const q3 = setConfig(q, { status: 'stopped' });
  assert('next null when stopped', nextActionable(q3) === null);

  // all done/failed → null (idle)
  const q4 = setConfig(
    parseQueue('- [x] task-001 — a\n- [!] task-002 — b\n'),
    { status: 'running' },
  );
  assert('next null when idle', nextActionable(q4) === null);
}

console.error(`\nqueue.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
