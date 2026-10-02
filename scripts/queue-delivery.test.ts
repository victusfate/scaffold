// Delivery boundaries survive implementation completion and process restarts.
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseQueue, beginTask, markDone, recordFailure, readyTasks, nextActionable,
  removeTask, serializeQueue, setConfig } from './queue-model.ts';
import { applyOp } from './queue-console.ts';

const now = new Date().toISOString();
const initial = parseQueue('- [ ] task-001 — First\n- [ ] task-002 — Second\n');
assert.equal(initial.config.deliveryMode, 'per-task');
assert.equal(readyTasks(setConfig(initial, { maxParallel: 4 })).length, 1);
const active = beginTask(initial, 'task-001', now);
assert.equal(active.config.deliveryTask, 'task-001');
assert.equal(applyOp(active, { op: 'claim-lane', id: 'task-002' }).ok, false);
const failed = recordFailure(active, 'task-001', 'red', 3, now).queue;
assert.equal(nextActionable(failed)?.id, 'task-001');
assert.equal(markDone(parseQueue('- [>] task-001 — Legacy\n'), 'task-001', now).config.deliveryTask, 'task-001');
assert.equal(recordFailure(parseQueue('- [>] task-001 — Legacy\n'), 'task-001', 'red', 3, now).queue.config.deliveryTask, 'task-001');
const legacy = parseQueue('- [>] task-001 — Legacy\n- [ ] task-002 — Next\n');
const forced = applyOp(legacy, { op: 'force-fail', id: 'task-001' }, now);
assert.ok(forced.ok);
assert.equal(nextActionable(forced.queue), null);
assert.equal(nextActionable(removeTask(legacy, 'task-001')), null);
const done = removeTask(markDone(active, 'task-001', now), 'task-001');
assert.equal(nextActionable(parseQueue(serializeQueue(done))), null);
assert.deepEqual(readyTasks(done), []);
assert.equal(readyTasks(setConfig(initial, { deliveryMode: 'batch', maxParallel: 4 })).length, 2);

const dir = mkdtempSync(join(tmpdir(), 'queue-delivery-'));
const cli = fileURLToPath(new URL('./queue.ts', import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, QUEUE_FILE: join(dir, 'queue.md') }, encoding: 'utf8', timeout: 10_000,
});
const ok = (...args: string[]) => {
  const r = run(...args); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout;
};
try {
  ok('add-many', 'First', 'Second');
  ok('tick');
  assert.notEqual(run('claim', 'task-002').status, 0);
  assert.notEqual(run('begin', 'task-002').status, 0);
  ok('done', 'task-001');
  ok('start'); // Start is not acknowledgment of a completed delivery cycle.
  assert.equal(run('tick').status, 7);
  assert.equal(run('ready').status, 7);
  assert.equal(run('signal').status, 3);
  assert.notEqual(run('advance', 'task-002', '--pr', 'https://github.com/a/b/pull/1', '--branch', 'feat/next').status, 0);
  assert.notEqual(run('advance', 'task-001').status, 0);
  ok('advance', 'task-001', '--pr', 'https://github.com/a/b/pull/1', '--branch', 'feat/next');
  assert.match(ok('tick'), /working task-002/);
  for (let i = 0; i < 3; i++) ok('fail', 'task-002', 'red');
  ok('archive');
  assert.notEqual(run('advance', 'task-002', '--pr', 'https://github.com/a/b/pull/2', '--branch', 'feat/next').status, 0);
  assert.equal(run('tick').status, 7);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('queue delivery tests passed');
