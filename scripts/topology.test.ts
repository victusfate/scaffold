#!/usr/bin/env node
// Tests for scripts/topology.ts — the consumer-owned agent topology reader.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTopology, loadTopology, TopologyError, DEFAULT_TICK_MINUTES } from './topology.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function rejects(label: string, raw: unknown, fragment: string): void {
  try { parseTopology(raw); assert(label, false, 'accepted'); }
  catch (e) { assert(label, e instanceof TopologyError && e.message.includes(fragment), String(e)); }
}

const GOOD = {
  orchestrator: { model: 'opus' }, tick_minutes: 6,
  slots: [
    { id: 'sonnet-1', harness: 'claude', model: 'sonnet' },
    { id: 'codex-1', harness: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
  ],
};

const t = parseTopology(GOOD);
assert('valid topology parses', t.slots.length === 2 && t.orchestrator.model === 'opus' && t.tickMinutes === 6);
assert('effort is optional and kept', t.slots[0].effort === undefined && t.slots[1].effort === 'high');
assert('open harness names are allowed', parseTopology({ orchestrator: { model: 'm' }, slots: [{ id: 'x-1', harness: 'future', model: 'z' }] }).slots[0].harness === 'future');
const bare = parseTopology({ orchestrator: { model: 'opus' } });
assert('slots and tick default', bare.slots.length === 0 && bare.tickMinutes === DEFAULT_TICK_MINUTES);

rejects('unknown top-level key (routing) rejected', { ...GOOD, routes: {} }, 'unknown key "routes"');
rejects('unknown slot key rejected', { ...GOOD, slots: [{ id: 'a', harness: 'claude', model: 'm', route: 'gpu' }] }, 'unknown key "route"');
rejects('unknown orchestrator key rejected', { orchestrator: { model: 'm', effort: 'x' } }, 'unknown key "effort"');
rejects('duplicate slot ids rejected', { ...GOOD, slots: [GOOD.slots[0], GOOD.slots[0]] }, 'duplicate slot id');
rejects('empty slot id rejected', { ...GOOD, slots: [{ id: '', harness: 'claude', model: 'm' }] }, 'slots[0].id');
rejects('non-kebab slot id rejected', { ...GOOD, slots: [{ id: 'Codex_1', harness: 'codex', model: 'm' }] }, 'kebab-case');
rejects('missing model rejected', { ...GOOD, slots: [{ id: 'a', harness: 'claude' }] }, 'slots[0].model');
rejects('missing orchestrator rejected', { slots: [] }, 'orchestrator must be an object');
rejects('bad tick rejected', { ...GOOD, tick_minutes: 0 }, 'tick_minutes');
rejects('non-object rejected', [], 'JSON object');
rejects('slots must be an array', { ...GOOD, slots: {} }, 'slots must be an array');

const dir = mkdtempSync(join(tmpdir(), 'topology-'));
const missing = loadTopology(join(dir, 'nope.json'));
assert('missing file is orchestrator only', missing.slots.length === 0 && missing.tickMinutes === DEFAULT_TICK_MINUTES);
writeFileSync(join(dir, 'ok.json'), JSON.stringify(GOOD));
assert('loadTopology reads a file', loadTopology(join(dir, 'ok.json')).slots[1].id === 'codex-1');
writeFileSync(join(dir, 'bad.json'), '{ nope');
try { loadTopology(join(dir, 'bad.json')); assert('invalid JSON throws', false); }
catch (e) { assert('invalid JSON throws TopologyError', e instanceof TopologyError && e.message.includes('invalid JSON')); }

console.error(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
