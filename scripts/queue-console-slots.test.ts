#!/usr/bin/env node
// Tests for the queue console's Slots panel (scripts/queue-console.ts consoleState): slot occupancy derives
// from task status (owner = slot id) and .agent/topology.json; split from queue-console.test.ts for length.

import { parseQueue } from './queue-model.ts';
import { consoleState } from './queue-console.ts';
import { parseTopology } from './topology.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ---- slots panel: occupancy derives from task status (owner = slot id) ----
{
  const topo = parseTopology({
    orchestrator: { model: 'opus' },
    slots: [
      { id: 'sonnet-1', harness: 'claude', model: 'sonnet' },
      { id: 'codex-1', harness: 'codex', model: 'gpt-6.1-sol' },
      { id: 'agy-1', harness: 'agy', model: 'flash' },
    ],
  });
  const q = parseQueue(`# Work Queue

- [>] task-010 — On codex
  - owner: codex-1
  - started: 2026-11-11T10:00:00.000Z
- [>] task-011 — Stray worker
  - owner: worker-9
- [>] task-012 — No owner
- [ ] task-013 — Waiting
`);
  const s = consoleState(q, topo, null, [{ id: 'task-010', worker: 'codex-1', model: null, step: null, state: 'running',
    startedAt: null, updatedAt: '2026-11-11T10:05:00.000Z', tail: null, stale: false, stop: false }]);
  const by = (id: string) => s.slots.find(x => x.id === id)!;
  assert('busy slot shows its task', by('codex-1').busy && by('codex-1').tasks[0].id === 'task-010'
    && by('codex-1').tasks[0].startedAt === '2026-11-11T10:00:00.000Z');
  assert('free slots are free', !by('sonnet-1').busy && !by('agy-1').busy && by('agy-1').tasks.length === 0);
  assert('lane heartbeat is optional detail', by('codex-1').lane?.updatedAt === '2026-11-11T10:05:00.000Z' && by('sonnet-1').lane === null);
  assert('orphans: owner not a slot, or no owner', s.orphans.map(o => o.id).join(',') === 'task-011,task-012');
  assert('pending tasks are never orphans', !s.orphans.some(o => o.id === 'task-013'));
  assert('state carries orchestrator and tick', s.topology?.orchestrator.model === 'opus' && s.topology.tickMinutes === 10);
  const twice = consoleState(parseQueue(`# Work Queue

- [>] task-020 — A
  - owner: codex-1
- [>] task-021 — B
  - owner: codex-1
`), topo);
  assert('two active tasks on one slot are flagged', twice.slots.find(x => x.id === 'codex-1')!.overbooked);
  const none = consoleState(q);
  assert('no slots declared: panel empty and nothing orphaned', none.slots.length === 0 && none.orphans.length === 0);
  const bad = consoleState(q, null, 'slots[0].id must be kebab-case');
  assert('invalid topology is reported, not fatal', bad.topology === null && bad.topologyError !== null && bad.slots.length === 0);
}

console.error(`\nqueue-console-slots.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
