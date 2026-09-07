// Fast public CLI validation tests, independent of scheduler services.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { duration } from './agent-loop-state.ts';

const cli = fileURLToPath(new URL('./agent-loop.ts', import.meta.url));
void test('duration aliases share exact finite bounds', () => {
  assert.equal(duration('10min'), duration('10m'));
  for (const value of ['0s', '-1s', '1.5h', 'Infinity', '999999999h', '10m;true']) assert.throws(() => duration(value));
});
void test('public CLI rejects malformed input and shell launchers', () => {
  for (const args of [['--interval', 'forever', '--', 'true'], ['--interval', '1s', '--', 'agent.cmd']]) {
    const result = spawnSync(process.execPath, [cli, 'start', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});
