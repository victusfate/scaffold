#!/usr/bin/env node
// Tests for scripts/queue-console.ts applyOp dependency integrity: the console guards the task DAG
// (no unknown deps, self-deps, cycles, or removal of a depended-on task); split from queue-console.test.ts for length.

import { parseQueue } from './queue-model.ts';
import { applyOp, type Op } from './queue-console.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ---- applyOp: dependency integrity — the interface guards the DAG ----
{
  const q = parseQueue('- [ ] task-001 — base\n- [ ] task-002 — mid\n  - deps: task-001\n'
    + '- [ ] task-003 — leaf\n  - deps: task-002\n- [x] task-004 — old\n');
  const err = (label: string, op: unknown): void => {
    const r = applyOp(q, op as Op);
    assert(label, !r.ok && typeof (r as { error: string }).error === 'string');
  };

  err('deps to a nonexistent task rejected', { op: 'set', id: 'task-003', fields: { deps: 'task-999' } });
  err('self-dependency rejected', { op: 'set', id: 'task-001', fields: { deps: 'task-001' } });
  err('dependency cycle rejected', { op: 'set', id: 'task-001', fields: { deps: 'task-003' } });
  err('add with unknown dep rejected', { op: 'add', title: 'x', fields: { deps: 'task-999' } });
  err('remove of a depended-on task rejected', { op: 'remove', id: 'task-001' });

  const leaf = applyOp(q, { op: 'remove', id: 'task-003' });
  assert('remove of a leaf allowed', leaf.ok);
  const done = applyOp(q, { op: 'remove', id: 'task-004' });
  assert('remove of a done task nothing depends on allowed', done.ok);
  const cleared = applyOp(q, { op: 'set', id: 'task-002', fields: { deps: '' } });
  assert('clearing deps allowed', cleared.ok && cleared.queue.tasks[1].dependsOn.length === 0);
  const valid = applyOp(q, { op: 'set', id: 'task-003', fields: { deps: 'task-001, task-002' } });
  assert('valid multi-dep accepted', valid.ok && valid.queue.tasks[2].dependsOn.join(',') === 'task-001,task-002');
}

console.error(`\nqueue-console-deps.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
