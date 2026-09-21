// Fast public CLI validation tests, independent of scheduler services.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanTerminalStartup, duration } from './agent-loop-state.ts';
import type { Config } from './agent-loop-state.ts';
import { execute, runArgv } from './agent-loop-process.ts';

const cli = fileURLToPath(new URL('./agent-loop.ts', import.meta.url));
const codexAdapter = fileURLToPath(new URL('./agent-loop-codex.ts', import.meta.url));

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
void test('runArgv capture path: session override wins over the minted id', () => {
  const config = baseConfig({
    warmArgv: ['codex', 'exec', 'resume', '{{SESSION}}', 'WARM'], session: 'minted-uuid',
  });
  // Cold run ignores the override (nothing captured yet); warm runs use the captured id.
  assert.deepEqual(runArgv(config, 1, undefined), ['claude', '-p', '--session-id', 'minted-uuid', 'COLD']);
  assert.deepEqual(runArgv(config, 2, 'captured-thread-id'),
    ['codex', 'exec', 'resume', 'captured-thread-id', 'WARM']);
  assert.deepEqual(runArgv(config, 9, 'captured-thread-id'),
    ['codex', 'exec', 'resume', 'captured-thread-id', 'WARM']);
});
void test('execute captures the reported resume id and substitutes it on the next run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-loop-resume-'));
  try {
    const config = baseConfig({
      cwd: dir,
      argv: ['codex', 'exec', 'COLD'],
      warmArgv: ['codex', 'exec', 'resume', '{{SESSION}}', 'WARM'],
      session: 'minted-uuid', timeout: 10_000,
    });
    // Run 1 (cold): child reports the CLI-generated id via `resume`.
    const coldChild = [
      "const {writeFileSync}=require('fs');",
      "writeFileSync(process.env.SCAFFOLD_AGENT_LOOP_RESULT,",
      " JSON.stringify({status:'continue',summary:'cold work',resume:'thread-abc'}));",
    ].join(' ');
    const cold = await execute({ ...config, argv: [process.execPath, '-e', coldChild] }, dir, 1, undefined);
    assert.equal(cold.directive?.resume, 'thread-abc');
    // Next run's warm argv must carry the captured id, not the minted one.
    assert.deepEqual(runArgv(config, 2, cold.directive?.resume),
      ['codex', 'exec', 'resume', 'thread-abc', 'WARM']);
    // Blank resume is ignored (pre-set path unchanged).
    const blankChild = [
      "const {writeFileSync}=require('fs');",
      "writeFileSync(process.env.SCAFFOLD_AGENT_LOOP_RESULT,",
      " JSON.stringify({status:'continue',summary:'warm work',resume:'  '}));",
    ].join(' ');
    const warmConfig = baseConfig({
      cwd: dir, argv: [process.execPath, '-e', blankChild], timeout: 10_000,
    });
    const warm = await execute(warmConfig, dir, 1, 'thread-abc');
    assert.equal(warm.directive?.resume, undefined);
    assert.deepEqual(warm.directive, { status: 'continue', summary: 'warm work' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
void test('startup accepts only a clean terminal supervisor outcome', () => {
  const ended = { runs: 0, failures: 0, running: false, generation: 'g', ready: true, ended: true };
  assert.equal(cleanTerminalStartup({ ...ended, reason: 'supervisor crashed' }, 'g'), false);
  assert.equal(cleanTerminalStartup({ ...ended, settled: true, reason: 'completed' }, 'g'), true);
  assert.equal(cleanTerminalStartup({ ...ended, settled: true }, 'other'), false);
});
void test('public CLI rejects malformed input and shell launchers', () => {
  for (const args of [['--interval', 'forever', '--', 'true'], ['--interval', '1s', '--', 'agent.cmd']]) {
    const result = spawnSync(process.execPath, [cli, 'start', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});
void test('Codex adapter produces a private result and fails closed on protocol errors', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-codex-errors-'));
  const resultPath = join(cwd, 'result.json');
  const env = { ...process.env, SCAFFOLD_AGENT_LOOP_RESULT: resultPath };
  const run = (script: string, codexArgs: string[] = [], prompt = 'literal --last prompt') => spawnSync(process.execPath,
    [codexAdapter, process.execPath, '-e', script, '--', ...codexArgs, '--prompt', prompt],
    { env, encoding: 'utf8' });
  try {
    const valid = [
      'const fs=require("node:fs"),args=process.argv.slice(1),at=args.indexOf("-o");',
      'if(process.env.SCAFFOLD_AGENT_LOOP_RESULT)process.exit(4);',
      'if(args.at(-2)!=="--"||args.at(-1)!=="--prompt")process.exit(5);',
      'fs.writeFileSync(args[at+1],JSON.stringify({status:"complete",summary:"done"}));',
      'console.log(JSON.stringify({type:"thread.started",thread_id:"exact-thread"}));',
      'console.log(JSON.stringify({type:"turn.completed"}))',
    ].join('');
    const success = run(valid, ['--oss'], '--prompt');
    assert.equal(success.status, 0, success.stderr);
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), {
      status: 'complete', summary: 'done', resume: 'exact-thread',
    });
    rmSync(resultPath);

    for (const option of ['--last', '--output-schema=other.json', '--output-last-message=other.json', '-oother.json']) {
      const conflict = run('process.exit(0)', [option]);
      assert.equal(conflict.status, 1);
      assert.match(conflict.stderr, /managed/);
    }

    const malformed = [
      'const fs=require("node:fs"),args=process.argv.slice(1),at=args.indexOf("-o");',
      'fs.writeFileSync(args[at+1],JSON.stringify({status:"complete",summary:"done"}));',
      'console.log("not JSONL")',
    ].join('');
    const invalid = run(malformed);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Unexpected token|JSON/);
    assert.equal(existsSync(resultPath), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
