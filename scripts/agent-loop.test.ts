import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { duration } from './agent-loop-state.ts';

const cli = new URL('./agent-loop.ts', import.meta.url).pathname;
void test('duration aliases share exact finite bounds', () => {
  assert.equal(duration('10min'), duration('10m'));
  for (const value of ['0s', '-1s', '1.5h', 'Infinity', '999999999h', '10m;true']) {
    assert.throws(() => duration(value), /Invalid duration/);
  }
});
void test('public CLI rejects malformed intervals before scheduling', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-test-'));
  const result = spawnSync(process.execPath, [cli, 'start', '--cwd', cwd,
    '--interval', 'forever', '--', 'true'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid duration/);
  rmSync(cwd, { recursive: true });
});

void test('unsupported manager fails closed without claiming an armed loop', () => {
  const result = spawnSync(process.execPath, [cli, 'start', '--interval', '10m', '--', 'true'], {
    encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent-agent-loop-test' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /systemd user manager/);
  assert.equal(result.stdout, '');
});

void test('public lifecycle with a fake manager preserves argv, rejects duplicates, and reports stop failures', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-loop-manager-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const manager = `#!${process.execPath}
const fs = require('node:fs');
const path = process.env.LOOP_TEST_STATE;
const args = process.argv.slice(2);
if (args.includes('show-environment')) process.exit(0);
if (args.includes('show')) { console.log(fs.existsSync(path) && args.some(a => a.endsWith('.timer')) ? 'active' : 'inactive'); process.exit(0); }
if (args.includes('stop')) { if (process.env.LOOP_TEST_FAIL_STOP) process.exit(1); fs.rmSync(path, {force:true}); process.exit(0); }
if (process.env.LOOP_TEST_FAIL_ARM) process.exit(1);
fs.writeFileSync(path, JSON.stringify(args));
`;
  for (const name of ['systemctl', 'systemd-run']) writeFileSync(join(bin, name), manager, { mode: 0o700 });
  const env = { ...process.env, PATH: bin, XDG_STATE_HOME: root, LOOP_TEST_STATE: join(root, 'armed') };
  const call = (args: string[], extra = {}) => spawnSync(process.execPath, [cli, args[0], '--cwd', root, ...args.slice(1)], {
    encoding: 'utf8', env: { ...env, ...extra },
  });
  const argv = ['echo', 'two words', "'quotes'", '$HOME; touch BAD', 'line\nbreak', ''];
  try {
    const started = call(['start', '--interval', '10min', '--', ...argv]);
    assert.equal(started.status, 0, started.stderr);
    const state = JSON.parse(started.stdout) as { argv: string[]; armed: boolean };
    assert.deepEqual(state.argv, argv);
    assert.equal(state.armed, true);
    assert.match(readFileSync(join(root, 'armed'), 'utf8'), /RuntimeMaxSec=1800000ms/);
    assert.notEqual(call(['start', '--interval', '10m', '--', 'true']).status, 0);
    assert.notEqual(call(['stop'], { LOOP_TEST_FAIL_STOP: '1' }).status, 0);
    assert.equal((JSON.parse(call(['status']).stdout) as { armed: boolean }).armed, true);
    assert.equal(call(['stop']).status, 0);
    assert.notEqual(call(['start', '--interval', '1s', '--', 'true'], { LOOP_TEST_FAIL_ARM: '1' }).status, 0);
    assert.equal((JSON.parse(call(['status']).stdout) as { armed: boolean }).armed, false);
  } finally { rmSync(root, { recursive: true }); }
});
