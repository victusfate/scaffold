import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const cli = new URL('./agent-loop.ts', import.meta.url).pathname;
const enabled = process.env.AGENT_LOOP_SYSTEMD_TEST === '1';
interface Status { runs: number; failures: number; armed: boolean; running: boolean; output: string }

function invoke(cwd: string, args: string[], success = true): Status {
  const result = spawnSync(process.execPath, [cli, args[0], '--cwd', cwd, ...args.slice(1)], { encoding: 'utf8' });
  if (success) assert.equal(result.status, 0, result.stderr);
  else { assert.notEqual(result.status, 0); return {} as Status; }
  return JSON.parse(result.stdout) as Status;
}

function start(cwd: string, options: string[], script: string, argv: string[] = []): Status {
  const result = spawnSync(process.execPath, [cli, 'start', '--cwd', cwd, '--interval', '100ms',
    '--lifetime', '30s', ...options, '--', process.execPath, '-e', script, ...argv], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Status;
}

async function until(cwd: string, predicate: (status: Status) => boolean): Promise<Status> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = invoke(cwd, ['status']);
    if (predicate(status)) return status;
    await delay(100);
  }
  throw new Error(`Timed out: ${JSON.stringify(invoke(cwd, ['logs']))}`);
}

void test('real systemd preserves argv, repeats serially, and stops future runs', { skip: !enabled }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-smoke-'));
  const argv = ['two words', "'quoted'", '$HOME; touch BAD', 'line\nsecond', '%i', ''];
  try {
    start(cwd, [], 'console.log(JSON.stringify(process.argv.slice(1))); setTimeout(()=>{}, 300)', argv);
    invoke(cwd, ['start', '--interval', '1s', '--', 'true'], false);
    await until(cwd, status => status.runs >= 2 && status.running);
    const stopped = invoke(cwd, ['stop']);
    assert.equal(stopped.armed, false);
    assert.equal(stopped.running, true);
    const finished = await until(cwd, status => !status.running);
    await delay(400);
    assert.equal(invoke(cwd, ['status']).runs, finished.runs);
    assert.match(invoke(cwd, ['logs']).output, new RegExp(JSON.stringify(argv).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(existsSync(join(cwd, 'BAD')), false);
  } finally { invoke(cwd, ['stop', '--cancel']); rmSync(cwd, { recursive: true }); }
});

void test('real systemd enforces failures and group timeout', { skip: !enabled }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-timeout-'));
  try {
    start(cwd, ['--timeout', '200ms', '--max-failures', '2'], 'setInterval(()=>{}, 100)');
    const stopped = await until(cwd, status => !status.armed);
    assert.equal(stopped.runs, 2);
    assert.equal(stopped.failures, 2);
  } finally { invoke(cwd, ['stop', '--cancel']); rmSync(cwd, { recursive: true }); }
});

void test('real systemd explicit cancellation kills descendants', { skip: !enabled }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-cancel-'));
  try {
    start(cwd, [], `require('child_process').spawn(process.execPath, ['-e', "setInterval(()=>require('fs').appendFileSync('ticks', 'x'), 50)"], {stdio:'inherit'}); setInterval(()=>{},100)`);
    await until(cwd, () => existsSync(join(cwd, 'ticks')));
    invoke(cwd, ['stop', '--cancel']);
    const ticks = readFileSync(join(cwd, 'ticks'), 'utf8');
    await delay(300);
    assert.equal(readFileSync(join(cwd, 'ticks'), 'utf8'), ticks);
  } finally { invoke(cwd, ['stop', '--cancel']); rmSync(cwd, { recursive: true }); }
});
