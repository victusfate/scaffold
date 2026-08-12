#!/usr/bin/env node
// Tests for scripts/queue-model.ts — the pure work-queue engine.

import {
  parseQueue, serializeQueue, newTask,
  addTask, addMany, setTaskStatus, setField, moveToTop, removeTask, setConfig,
  beginTask, markDone, recordFailure, reclaimStale,
  isEligible, deadlocked, nextActionable, readyTasks,
  type Queue,
} from './queue-model.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const NOW = '2026-08-12T20:00:00.000Z';

const SAMPLE = `# Work Queue

<!-- queue:config
status: running
interval: 6m
maxFailures: 3
leaseMinutes: 30
maxParallel: 2
integrationBranch: queue/integration
-->

- [ ] task-001 — Add telemetry interface
  - mode: chain
  - slug: telemetry
  - deps: task-000
  - files: src/telemetry.ts, test/telemetry.test.ts
  - validate: npm test
  - accept: metrics emitted on request
  - failures: 1
- [>] task-002 — Refactor the parser
  - owner: worker-a
  - started: 2026-08-12T19:59:00.000Z
- [x] task-003 — Fix the login bug
- [!] task-004 — Broken migration
`;

// ---- parse rich fields ----
{
  const q = parseQueue(SAMPLE);
  assert('config maxParallel', q.config.maxParallel === 2, String(q.config.maxParallel));
  assert('config integrationBranch', q.config.integrationBranch === 'queue/integration');
  assert('config leaseMinutes', q.config.leaseMinutes === 30);
  const t1 = q.tasks[0];
  assert('task mode', t1.mode === 'chain');
  assert('task slug', t1.slug === 'telemetry');
  assert('task deps', t1.dependsOn.length === 1 && t1.dependsOn[0] === 'task-000');
  assert('task files', t1.files.length === 2 && t1.files[1] === 'test/telemetry.test.ts');
  assert('task validate', t1.validate === 'npm test');
  assert('task accept', t1.accept === 'metrics emitted on request');
  assert('task failures', t1.failures === 1);
  assert('task2 owner', q.tasks[1].owner === 'worker-a');
  assert('task2 started', q.tasks[1].startedAt === '2026-08-12T19:59:00.000Z');
  assert('statuses', q.tasks[1].status === 'active' && q.tasks[2].status === 'done'
    && q.tasks[3].status === 'failed');
}

// ---- round-trip stability ----
{
  const q1 = parseQueue(SAMPLE);
  const q2 = parseQueue(serializeQueue(q1));
  assert('round-trip config', JSON.stringify(q1.config) === JSON.stringify(q2.config));
  assert('round-trip tasks', JSON.stringify(q1.tasks) === JSON.stringify(q2.tasks),
    serializeQueue(q1));
}

// ---- forgiving parse + defaults ----
{
  const q = parseQueue('- [ ] just do the thing\n');
  assert('bare line parsed', q.tasks.length === 1 && q.tasks[0].title === 'just do the thing');
  assert('bare line defaults direct', q.tasks[0].mode === 'direct');
  assert('bare line gets id', /task-\d+/.test(serializeQueue(q)));
  const e = parseQueue('');
  assert('empty defaults', e.config.status === 'running' && e.tasks.length === 0
    && e.config.maxParallel === 1);
}

// ---- addTask with metadata + addMany ----
{
  const q = parseQueue('');
  const q2 = addTask(q, 'Ship it', { mode: 'chain', slug: 'ship', validate: 'npm test' });
  assert('addTask metadata', q2.tasks[0].mode === 'chain' && q2.tasks[0].slug === 'ship'
    && q2.tasks[0].validate === 'npm test');
  assert('addTask id', q2.tasks[0].id === 'task-001');
  const q3 = addMany(q, ['a', 'b', 'c']);
  assert('addMany', q3.tasks.length === 3 && q3.tasks[2].id === 'task-003');
  assert('addMany extends', addMany(parseQueue(SAMPLE), ['x']).tasks.length === 5);
}

// ---- setField / moveToTop / removeTask / setConfig ----
{
  const q = parseQueue(SAMPLE);
  assert('setField deps', setField(q, 'task-002', { dependsOn: ['task-001'] })
    .tasks[1].dependsOn[0] === 'task-001');
  assert('moveToTop', moveToTop(q, 'task-004').tasks[0].id === 'task-004');
  assert('removeTask', removeTask(q, 'task-002').tasks.length === 3);
  assert('setConfig maxParallel', setConfig(q, { maxParallel: 4 }).config.maxParallel === 4);
}

// ---- retry semantics: fail retries to back, then goes terminal ----
{
  let q: Queue = parseQueue('- [>] task-001 — flaky\n- [ ] task-002 — other\n');
  q = setConfig(q, { maxFailures: 3 });
  const r1 = recordFailure(q, 'task-001', 'boom', 3);
  assert('fail 1 retries (pending)', r1.queue.tasks.find(t => t.id === 'task-001')?.status === 'pending');
  assert('fail 1 not terminal', !r1.terminal && r1.failures === 1);
  assert('retry moves to back', r1.queue.tasks[r1.queue.tasks.length - 1].id === 'task-001');
  assert('retry records note', r1.queue.tasks.find(t => t.id === 'task-001')?.note === 'boom');
  const r2 = recordFailure(r1.queue, 'task-001', null, 3);
  const r3 = recordFailure(r2.queue, 'task-001', 'still broken', 3);
  assert('fail 3 terminal', r3.terminal && r3.failures === 3);
  assert('terminal is failed', r3.queue.tasks.find(t => t.id === 'task-001')?.status === 'failed');
  assert('terminal keeps position', r3.queue.tasks.find(t => t.id === 'task-001') !== undefined);
}

// ---- lease reclaim ----
{
  const q = parseQueue(SAMPLE); // task-002 active, started 19:59, NOW 20:00 → 1 min old
  const fresh = reclaimStale(q, NOW, 30);
  assert('fresh lease not reclaimed', fresh.reclaimed.length === 0
    && fresh.queue.tasks[1].status === 'active');
  const stale = reclaimStale(q, '2026-08-12T21:00:00.000Z', 30); // 61 min old
  assert('stale lease reclaimed', stale.reclaimed.length === 1 && stale.reclaimed[0].id === 'task-002');
  assert('reclaimed back to pending', stale.queue.tasks[1].status === 'pending'
    && stale.queue.tasks[1].owner === null);
}

// ---- eligibility, deadlock, selection ----
{
  const q = parseQueue(SAMPLE);
  // task-001 depends on task-000 (absent) → not eligible
  assert('dep-gated not eligible', !isEligible(q.tasks[0], q));
  const q2 = setField(setTaskStatus(addTask(q, 'root'), 'task-005', 'done'), 'task-001',
    { dependsOn: ['task-005'] });
  assert('eligible when dep done', isEligible(q2.tasks.find(t => t.id === 'task-001')!, q2));

  // deadlock: pending task whose dep failed
  const dl = parseQueue('- [!] task-001 — base\n- [ ] task-002 — dep\n  - deps: task-001\n');
  assert('deadlocked detected', deadlocked(dl).length === 1 && deadlocked(dl)[0].id === 'task-002');

  // nextActionable resumes active
  assert('next resumes active', nextActionable(q)?.id === 'task-002');
  // stopped → null
  assert('next stopped null', nextActionable(setConfig(q, { status: 'stopped' })) === null);
}

// ---- readyTasks concurrency cap ----
{
  // 3 independent pending, maxParallel 2, 0 active → 2 ready
  let q = parseQueue('- [ ] task-001 — a\n- [ ] task-002 — b\n- [ ] task-003 — c\n');
  q = setConfig(q, { maxParallel: 2 });
  assert('ready under cap', readyTasks(q).map(t => t.id).join(',') === 'task-001,task-002');
  // one active consumes a slot → only 1 more ready
  q = beginTask(q, 'task-001', NOW, 'worker-a');
  assert('ready minus active', readyTasks(q).length === 1 && readyTasks(q)[0].id === 'task-002');
  // at cap → none
  q = beginTask(q, 'task-002', NOW, 'worker-b');
  assert('ready at cap empty', readyTasks(q).length === 0);
  // stopped → none
  assert('ready stopped empty', readyTasks(setConfig(q, { status: 'stopped' })).length === 0);
}

// ---- beginTask / markDone lifecycle ----
{
  let q = parseQueue('- [ ] task-001 — go\n');
  q = beginTask(q, 'task-001', NOW, 'w1');
  assert('begin sets active+owner+lease', q.tasks[0].status === 'active'
    && q.tasks[0].owner === 'w1' && q.tasks[0].startedAt === NOW);
  q = markDone(q, 'task-001');
  assert('done clears claim', q.tasks[0].status === 'done' && q.tasks[0].owner === null
    && q.tasks[0].startedAt === null);
}

console.error(`\nqueue.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
void newTask;
