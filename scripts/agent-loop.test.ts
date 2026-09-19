// Fast public CLI validation tests, independent of scheduler services.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { duration } from './agent-loop-state.ts';
import type { Config } from './agent-loop-state.ts';
import { runArgv } from './agent-loop-process.ts';

const cli = fileURLToPath(new URL('./agent-loop.ts', import.meta.url));

const baseConfig = (over: Partial<Config>): Config => ({
  cwd: '/tmp', unit: 'u', generation: 'g', argv: ['claude', '-p', '--session-id', '{{SESSION}}', 'COLD'],
  interval: 1, timeout: 1, expiresAt: 0, maxFailures: 1, requireResult: true, ...over,
});

void test('runArgv selects cold on run 1, warm after, and substitutes the session id', () => {
  const config = baseConfig({
    warmArgv: ['claude', '-p', '--resume', '{{SESSION}}', 'WARM'], session: 'sid-123',
  });
  assert.deepEqual(runArgv(config, 1), ['claude', '-p', '--session-id', 'sid-123', 'COLD']);
  assert.deepEqual(runArgv(config, 2), ['claude', '-p', '--resume', 'sid-123', 'WARM']);
  assert.deepEqual(runArgv(config, 9), ['claude', '-p', '--resume', 'sid-123', 'WARM']);
});
void test('runArgv without warm/session keeps the original argv every run', () => {
  const config = baseConfig({ argv: ['echo', 'hi'] });
  assert.deepEqual(runArgv(config, 1), ['echo', 'hi']);
  assert.deepEqual(runArgv(config, 5), ['echo', 'hi']);
});
void test('start rejects a warm command that is a shell launcher after the ::: sentinel', () => {
  const args = ['--interval', '1s', '--', 'true', ':::', 'warm.cmd'];
  const result = spawnSync(process.execPath, [cli, 'start', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});
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
