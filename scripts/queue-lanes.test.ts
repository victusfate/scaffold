#!/usr/bin/env node
// Tests for scripts/queue-lanes.ts — per-lane heartbeat sidecars the board
// reads (workers write, the server only reads) plus cooperative stop flags.

import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  beatLane, readLanes, clearLane, laneStale,
  requestStop, stopRequested, clearStopRequest,
} from './queue-lanes.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const dir = mkdtempSync(join(tmpdir(), 'queue-lanes-'));
process.env.QUEUE_FILE = join(dir, 'queue.md');

// ---- beat + read ----
{
  const lane = beatLane('task-002', { worker: 'demo-worker', step: 'tdd slice 3' });
  assert('beat stamps updatedAt', typeof lane.updatedAt === 'string' && lane.updatedAt.length > 0);
  assert('beat keeps worker and step', lane.worker === 'demo-worker' && lane.step === 'tdd slice 3');
  assert('beat persists the sidecar file', existsSync(join(dir, 'lanes', 'task-002.json')));

  const again = beatLane('task-002', { tail: 'tail line' });
  assert('second beat merges, keeps step', again.step === 'tdd slice 3' && again.tail === 'tail line');

  beatLane('task-007', { worker: 'w2' });
  const all = readLanes();
  assert('readLanes lists every lane', all.map(l => l.id).sort().join(',') === 'task-002,task-007');

  writeFileSync(join(dir, 'lanes', 'broken.json'), '{nope');
  assert('readLanes skips malformed files', readLanes().length === 2);
}

// ---- staleness is derived, never destructive ----
{
  const fresh = beatLane('task-009', { worker: 'w' });
  assert('fresh lane not stale',
    laneStale(fresh, new Date(Date.parse(fresh.updatedAt) + 60_000).toISOString(), 30) === false);
  assert('old lane stale',
    laneStale(fresh, new Date(Date.parse(fresh.updatedAt) + 31 * 60_000).toISOString(), 30) === true);
  assert('stale lane still readable', readLanes().some(l => l.id === 'task-009'));
}

// ---- cooperative stop flags ----
{
  assert('no stop requested initially', stopRequested('task-002') === false);
  requestStop('task-002');
  assert('stop flag visible', stopRequested('task-002') === true);
  clearStopRequest('task-002');
  assert('stop flag clearable', stopRequested('task-002') === false);
}

// ---- clear ----
{
  clearLane('task-007');
  assert('clear removes the lane', readLanes().every(l => l.id !== 'task-007'));
  clearLane('task-nope');
  assert('clear of unknown lane is a no-op', true);
}

delete process.env.QUEUE_FILE;
console.error(`\nqueue-lanes.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
