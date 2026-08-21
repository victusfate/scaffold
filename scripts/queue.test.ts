#!/usr/bin/env node
// Tests for scripts/queue-model.ts — the pure work-queue engine.

import {
  parseQueue, serializeQueue, newTask,
  addTask, addMany, setTaskStatus, setField, moveToTop, moveTask, removeTask, setConfig,
  beginTask, markDone, recordFailure, reclaimStale, pauseUntil, resumeIfDue, requeueTask,
  isEligible, deadlocked, nextActionable, readyTasks, drainSignal, DRAIN_MARKER,
  archivableDone,
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
  // The first serialize normalizes a counter-less file (self-heals nextId past the
  // highest existing id); round-trip is idempotent from there on.
  const q1 = parseQueue(serializeQueue(parseQueue(SAMPLE)));
  const q2 = parseQueue(serializeQueue(q1));
  assert('round-trip config', JSON.stringify(q1.config) === JSON.stringify(q2.config));
  assert('round-trip tasks', JSON.stringify(q1.tasks) === JSON.stringify(q2.tasks),
    serializeQueue(q1));
  assert('nextId self-heals past existing ids', q1.config.nextId === 5, String(q1.config.nextId));
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
  assert('cadence defaults', e.config.interval === '6m' && e.config.idlePoll === '20m'
    && e.config.pausePoll === '30m');
  assert('idlePoll round-trips',
    parseQueue(serializeQueue(setConfig(e, { idlePoll: '15m' }))).config.idlePoll === '15m');
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

// ---- usage-limit pause / auto-resume ----
{
  const base = parseQueue('- [ ] task-001 — go\n');
  const paused = pauseUntil(base, '2026-08-12T22:00:00.000Z');
  assert('pauseUntil stops + sets resumeAt', paused.config.status === 'stopped'
    && paused.config.resumeAt === '2026-08-12T22:00:00.000Z');
  assert('paused blocks selection', nextActionable(paused) === null);

  // before the window → stays paused
  const early = resumeIfDue(paused, '2026-08-12T21:00:00.000Z');
  assert('not resumed before window', !early.resumed && early.queue.config.status === 'stopped');
  // at/after the window → auto-resumes and clears resumeAt
  const late = resumeIfDue(paused, '2026-08-12T22:30:00.000Z');
  assert('auto-resumed after window', late.resumed && late.queue.config.status === 'running'
    && late.queue.config.resumeAt === '');
  assert('resumed queue selects again', nextActionable(late.queue)?.id === 'task-001');

  // a manual stop (no resumeAt) is never auto-resumed
  const manual = setConfig(base, { status: 'stopped' });
  assert('manual stop not auto-resumed', !resumeIfDue(manual, '2030-01-01T00:00:00.000Z').resumed);

  // round-trips through the file
  assert('resumeAt round-trips',
    parseQueue(serializeQueue(paused)).config.resumeAt === '2026-08-12T22:00:00.000Z');
}

// ---- drainSignal: non-empty + running ⇒ a driver is wanted ----
{
  // running with an eligible pending task and no active driver → DRAIN-WANTED
  const ready = parseQueue('- [ ] task-001 — a\n- [ ] task-002 — b\n');
  assert('drain wanted when idle+pending', drainSignal(ready) === `${DRAIN_MARKER} 2 pending`,
    String(drainSignal(ready)));

  // a driver already active → no signal (drain is attached)
  assert('no drain when active', drainSignal(beginTask(ready, 'task-001', NOW, 'w1')) === null);

  // empty running queue → genuinely idle, no signal
  assert('no drain when empty', drainSignal(parseQueue('')) === null);

  // stopped / paused is an operator halt, not a stalled drain → no signal
  assert('no drain when stopped', drainSignal(setConfig(ready, { status: 'stopped' })) === null);
  assert('no drain when paused', drainSignal(pauseUntil(ready, '2026-08-12T22:00:00.000Z')) === null);

  // all pending blocked by an unmet dep → nothing eligible → no signal (not a stall)
  const blocked = parseQueue('- [ ] task-002 — dep\n  - deps: task-000\n');
  assert('no drain when dep-blocked', drainSignal(blocked) === null);

  // only eligible pending are counted, dep-blocked ones excluded
  const mixed = parseQueue('- [x] task-001 — done\n- [ ] task-002 — go\n  - deps: task-001\n'
    + '- [ ] task-003 — blocked\n  - deps: task-000\n');
  assert('drain counts only eligible', drainSignal(mixed) === `${DRAIN_MARKER} 1 pending`,
    String(drainSignal(mixed)));
}

// ---- archivableDone: archive a completed task, but not while it's still a dep ----
{
  const ids = (ts: { id: string }[]): string => ts.map(t => t.id).sort().join(',');

  // independent done tasks → all archivable immediately
  const indep = parseQueue('- [x] task-001 — a\n- [x] task-002 — b\n- [ ] task-003 — c\n');
  assert('independent done are archivable', ids(archivableDone(indep)) === 'task-001,task-002');

  // a done task with a pending dependent is NOT archivable (would deadlock it)
  const chain = parseQueue('- [x] task-001 — base\n- [ ] task-002 — dep\n  - deps: task-001\n');
  assert('done kept while a pending task depends on it', archivableDone(chain).length === 0);

  // an active dependent also pins its done dependency
  const activeDep = parseQueue('- [x] task-001 — base\n- [>] task-002 — dep\n  - deps: task-001\n');
  assert('done kept while an active task depends on it', archivableDone(activeDep).length === 0);

  // once the dependent finishes, the whole chain becomes archivable
  const chainDone = markDone(chain, 'task-002');
  assert('chain archivable after dependent done', ids(archivableDone(chainDone)) === 'task-001,task-002');

  // failed tasks are never auto-archived (kept for deadlock visibility)
  const failed = parseQueue('- [!] task-001 — boom\n- [x] task-002 — ok\n');
  assert('failed never archivable', ids(archivableDone(failed)) === 'task-002');

  // a done task whose only dependent already failed terminally is archivable
  const depFailed = parseQueue('- [x] task-001 — base\n- [!] task-002 — dep\n  - deps: task-001\n');
  assert('done archivable once its dependent has failed', ids(archivableDone(depFailed)) === 'task-001');
}

// ---- monotonic ids: never recycle after archival/removal ----
{
  const idOf = (q: Queue, i: number): string => q.tasks[i].id;

  // sequential adds increment
  let q = addTask(addTask(parseQueue(''), 'a'), 'b');
  assert('first two ids are 001,002', idOf(q, 0) === 'task-001' && idOf(q, 1) === 'task-002');
  assert('nextId advanced to 3', q.config.nextId === 3);

  // remove both, then add — id does NOT recycle to 001
  q = removeTask(removeTask(q, 'task-001'), 'task-002');
  assert('queue emptied', q.tasks.length === 0);
  q = addTask(q, 'c');
  assert('id continues at 003 after removal', idOf(q, 0) === 'task-003', idOf(q, 0));

  // the counter survives a file round-trip even with an empty queue
  const drained = parseQueue(serializeQueue(removeTask(q, 'task-003')));
  assert('empty queue persists nextId', drained.config.nextId === 4, String(drained.config.nextId));
  assert('post-drain add keeps climbing', addTask(drained, 'd').tasks[0].id === 'task-004');

  // addMany allocates a contiguous monotonic run
  const many = addMany(addTask(parseQueue(''), 'x'), ['y', 'z']);
  assert('addMany continues the counter',
    many.tasks.map(t => t.id).join(',') === 'task-001,task-002,task-003');
  assert('addMany advances nextId', many.config.nextId === 4);

  // a hand-typed high id pushes the counter past it (no collision on next add)
  const handHigh = addTask(parseQueue('- [ ] task-050 — hand\n'), 'auto');
  assert('add after a hand-typed high id jumps past it', handHigh.tasks[1].id === 'task-051');

  // an id-less hand-added line gets a monotonic id that also advances the counter
  const handless = parseQueue(serializeQueue(setConfig(parseQueue('- [ ] no id here\n'), { nextId: 9 })));
  assert('id-less line synthesized from the counter', handless.tasks[0].id === 'task-009', handless.tasks[0].id);
  assert('counter advanced past the synthesized id', handless.config.nextId === 10);
}

// ---- moveTask: reorder to an explicit position ----
{
  const order = (q: Queue): string => q.tasks.map(t => t.id).join(',');
  const q = parseQueue('- [ ] task-001 — a\n- [ ] task-002 — b\n- [ ] task-003 — c\n- [ ] task-004 — d\n');

  assert('move to head', order(moveTask(q, 'task-003', 0)) === 'task-003,task-001,task-002,task-004');
  assert('move to middle', order(moveTask(q, 'task-001', 2)) === 'task-002,task-003,task-001,task-004');
  assert('move to last', order(moveTask(q, 'task-001', 3)) === 'task-002,task-003,task-004,task-001');
  assert('move clamps past end', order(moveTask(q, 'task-002', 99)) === 'task-001,task-003,task-004,task-002');
  assert('move clamps negative', order(moveTask(q, 'task-004', -5)) === 'task-004,task-001,task-002,task-003');
  assert('move unknown id is a no-op', order(moveTask(q, 'task-999', 0)) === order(q));
  assert('move preserves untouched relative order',
    order(moveTask(q, 'task-002', 3)) === 'task-001,task-003,task-004,task-002');
  assert('move keeps task fields intact',
    moveTask(parseQueue(SAMPLE), 'task-004', 0).tasks[0].status === 'failed');
  assert('move survives round-trip',
    order(parseQueue(serializeQueue(moveTask(q, 'task-003', 0)))) === 'task-003,task-001,task-002,task-004');
}

// ---- requeueTask: revive a failed task in place ----
{
  const md = '- [ ] task-001 — a\n- [!] task-002 — boom\n  - failures: 3\n  - note: needs-spec: which db?\n'
    + '  - owner: worker-a\n  - started: 2026-08-12T19:00:00.000Z\n- [ ] task-003 — c\n  - failures: 2\n';
  const q = parseQueue(md);

  const revived = requeueTask(q, 'task-002').tasks[1];
  assert('requeue failed → pending', revived.status === 'pending');
  assert('requeue clears failures', revived.failures === 0);
  assert('requeue clears note/owner/started',
    revived.note === null && revived.owner === null && revived.startedAt === null);
  assert('requeue keeps position', requeueTask(q, 'task-002').tasks.map(t => t.id).join(',')
    === 'task-001,task-002,task-003');

  const retried = requeueTask(q, 'task-003').tasks[2];
  assert('requeue resets a retrying pending task', retried.failures === 0 && retried.status === 'pending');

  assert('requeue clean pending is a no-op',
    JSON.stringify(requeueTask(q, 'task-001')) === JSON.stringify(q));
  assert('requeue unknown id is a no-op',
    JSON.stringify(requeueTask(q, 'task-999')) === JSON.stringify(q));
  assert('requeue survives round-trip',
    parseQueue(serializeQueue(requeueTask(q, 'task-002'))).tasks[1].status === 'pending');
}

console.error(`\nqueue.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
void newTask;
