#!/usr/bin/env node
// Tests for agent-time tracking: the cumulative elapsed-seconds model
// (banking rule, duration grammar, serialization) in scripts/queue-model.ts.

import {
  parseQueue, serializeQueue, setField, fieldPatch,
  beginTask, markDone, recordFailure, unclaimTask, reopenTask,
  parseDurationSecs, formatDurationSecs,
} from './queue-model.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ---- elapsed banking: every session end adds now−startedAt to the total ----
{
  const T0 = '2026-09-11T15:00:00.000Z';
  const T1 = '2026-09-11T16:30:00.000Z'; // +90m
  const T2 = '2026-09-11T17:00:00.000Z'; // +30m more
  let q = parseQueue('- [ ] task-001 — a\n');
  q = beginTask(q, 'task-001', T0, 'w1');
  assert('fresh task starts at zero', q.tasks[0].elapsedSecs === 0);
  q = markDone(q, 'task-001', T1);
  assert('done banks the session in seconds', q.tasks[0].elapsedSecs === 5400);

  // sub-minute sessions keep their seconds
  let s = beginTask(parseQueue('- [ ] task-001 — a\n'), 'task-001', T0, 'w1');
  s = markDone(s, 'task-001', '2026-09-11T15:00:45.000Z');
  assert('seconds survive', s.tasks[0].elapsedSecs === 45);

  // accumulation across sessions: reopen, work again, release
  q = reopenTask(q, 'task-001');
  q = beginTask(q, 'task-001', T1, 'w2');
  q = unclaimTask(q, 'task-001', T2);
  assert('sessions accumulate', q.tasks[0].elapsedSecs === 7200);

  // fail banks the attempt too, then retries keep the total
  q = beginTask(q, 'task-001', T2, 'w3');
  const failed = recordFailure(q, 'task-001', 'boom', 3, '2026-09-11T17:05:00.000Z');
  assert('fail banks the attempt', failed.queue.tasks[0].elapsedSecs === 7500);

  // ending a session with no lease banks nothing
  const idle = markDone(parseQueue('- [ ] task-001 — a\n'), 'task-001', T1);
  assert('no lease banks zero', idle.tasks[0].elapsedSecs === 0);

  // duration grammar round-trips (bare numbers are minutes)
  assert('parses 2h15m30s', parseDurationSecs('2h15m30s') === 8130);
  assert('parses bare minutes', parseDurationSecs('45') === 2700);
  assert('parses seconds', parseDurationSecs('30s') === 30);
  assert('scales 45s', formatDurationSecs(45) === '45s');
  assert('scales 90m not hours', formatDurationSecs(5400) === '90m');
  assert('floors to whole minutes', formatDurationSecs(8130) === '135m');
  const withed = setField(parseQueue('- [ ] task-001 — a\n'), 'task-001', fieldPatch('elapsed', '1h'));
  assert('elapsed settable + serialized exact',
    withed.tasks[0].elapsedSecs === 3600
    && serializeQueue(withed).includes('- elapsed: 1h')
    && parseQueue(serializeQueue(withed)).tasks[0].elapsedSecs === 3600);
}

console.error(`\nqueue-elapsed.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
