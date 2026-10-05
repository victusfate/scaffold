#!/usr/bin/env node
// Tests for the PARKED queue state (scripts/queue-model.ts parkTask / isParked): a task whose lane
// stopped with work in hand returns to pending but keeps its branch, and renders `[~]`.

import { parseQueue, serializeQueue, parkTask, isParked, type Queue } from './queue-model.ts';
import { parse } from './queue-cli-args.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const NOW = '2026-08-12T20:00:00.000Z';
// PARKED: a lane stopped with work in hand → pending + branch, rendered [~], resumable.
{
  let q: Queue = parseQueue('- [>] task-001 — half built\n  - owner: lane-1\n  - started: 2026-08-12T19:00:00.000Z\n- [ ] task-002 — fresh\n');
  q = parkTask(q, 'task-001', 'feat/half-built', 'slice 3 next', NOW);
  const t = q.tasks[0];
  assert('park returns an active task to pending', t.status === 'pending');
  assert('park clears the owner and lease', t.owner === null && t.startedAt === null);
  assert('park banks the active session time', t.elapsedSecs === 3600);
  assert('park records the branch and a dated resume line', t.branch === 'feat/half-built' && /parked 2026-08-12: slice 3 next/.test(t.note ?? ''));
  assert('a parked task is distinguishable from a fresh pending one', isParked(t) && !isParked(q.tasks[1]));
  const md = serializeQueue(q);
  assert('a parked task renders [~]', md.includes('- [~] task-001 — half built') && md.includes('- [ ] task-002 — fresh'));
  const back = parseQueue(md);
  assert('[~] parses back to pending with its branch', back.tasks[0].status === 'pending' && back.tasks[0].branch === 'feat/half-built' && isParked(back.tasks[0]));
  assert('park without a branch is a no-op', parkTask(q, 'task-002', '', 'x', NOW).tasks[1].branch === null);
  const done = parseQueue('- [x] task-003 — finished\n');
  assert('park never reopens a done task', parkTask(done, 'task-003', 'b', '', NOW).tasks[0].status === 'done');
}

// The CLI hands `park <id> --branch b --resume "step"` its values (they were silently dropped before).
{
  const f = parse(['task-001', '--branch', 'feat/x', '--resume', 'slice 2 next']);
  assert('park --branch reaches the command', f.flags.get('branch') === 'feat/x');
  assert('park --resume reaches the command', f.flags.get('resume') === 'slice 2 next');
  assert('the id stays positional', f.positionals[0] === 'task-001');
}

console.error(`\nqueue-park.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
