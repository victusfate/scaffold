// Fast public CLI validation tests, independent of scheduler services.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { duration } from './agent-loop-state.ts';
import type { Config } from './agent-loop-state.ts';
import { execute, runArgv } from './agent-loop-process.ts';

const cli = fileURLToPath(new URL('./agent-loop.ts', import.meta.url));
const codexAdapter = fileURLToPath(new URL('./agent-loop-codex.ts', import.meta.url));
const CODEX_TEST_TIMEOUT_MS = 8_000;
const CODEX_POLL_MS = 50;

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
void test('public CLI rejects malformed input and shell launchers', () => {
  for (const args of [['--interval', 'forever', '--', 'true'], ['--interval', '1s', '--', 'agent.cmd']]) {
    const result = spawnSync(process.execPath, [cli, 'start', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});
void test('Codex adapter captures the cold thread and resumes that exact session', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-codex-'));
  const calls = join(cwd, 'calls.jsonl');
  const env = { ...process.env, XDG_STATE_HOME: join(cwd, 'state') };
  const fixture = [
    'const fs=require("node:fs");',
    'const args=process.argv.slice(1),calls=args.shift(),mode=args.shift(),session=args.shift();',
    'const outputAt=args.indexOf("-o"),schemaAt=args.indexOf("--output-schema");',
    'if(!args.includes("--json")||outputAt<0||schemaAt<0)process.exit(2);',
    'fs.appendFileSync(calls,JSON.stringify({mode,session,args})+"\\n");',
    'const exact="codex-thread-117";',
    'const directive=mode==="cold"?{status:"continue",summary:"cold complete"}:session===exact?{status:"complete",summary:"warm complete"}:{status:"blocked",summary:"wrong session"};',
    'fs.writeFileSync(args[outputAt+1],JSON.stringify(directive));',
    'console.log(JSON.stringify({type:"thread.started",thread_id:exact}));',
    'console.log(JSON.stringify({type:"turn.completed"}));',
  ].join('');
  const literalPrompt = 'literal $HOME; touch BAD `still data`';
  const wrapped = (mode: string, session = '') => [process.execPath, codexAdapter, '--',
    process.execPath, '-e', fixture, calls, mode, session, 'exec', literalPrompt];
  try {
    const started = spawnSync(process.execPath, [cli, 'start', '--cwd', cwd, '--interval', '10ms',
      '--lifetime', '10s', '--timeout', '5s', '--max-failures', '1', '--require-result', '--',
      ...wrapped('cold'), ':::', ...wrapped('warm', '{{SESSION}}')], { env, encoding: 'utf8' });
    assert.equal(started.status, 0, started.stderr);
    let status: { ended?: boolean; failures?: number; reason?: string; session?: string } = {};
    const deadline = Date.now() + CODEX_TEST_TIMEOUT_MS;
    while (!status.ended && Date.now() < deadline) {
      await delay(CODEX_POLL_MS);
      const result = spawnSync(process.execPath, [cli, 'status', '--cwd', cwd], { env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      status = JSON.parse(result.stdout) as typeof status;
    }
    assert.equal(status.reason, 'completed');
    assert.equal(status.failures, 0);
    assert.equal(status.session, 'codex-thread-117');
    const recorded = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      mode: string; session?: string; args: string[];
    });
    assert.deepEqual(recorded.map(call => [call.mode, call.session]), [
      ['cold', ''], ['warm', 'codex-thread-117'],
    ]);
    assert.ok(recorded.every(call => call.args.includes(literalPrompt)));
    assert.ok(recorded.every(call => call.args.includes('--output-schema') && call.args.includes('-o')));
    assert.ok(recorded.every(call => !call.args.includes('--last')));
    const stateRoot = join(cwd, 'state', 'scaffold-agent-loop');
    const stateDir = join(stateRoot, readdirSync(stateRoot)[0]!);
    assert.equal(readdirSync(stateDir).some(name => name.startsWith('codex-result-')), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
void test('Codex adapter fails closed on conflicting options and malformed JSONL', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agent-loop-codex-errors-'));
  const resultPath = join(cwd, 'result.json');
  const env = { ...process.env, SCAFFOLD_AGENT_LOOP_RESULT: resultPath };
  const run = (childArgs: string[]) => spawnSync(process.execPath,
    [codexAdapter, '--', process.execPath, ...childArgs], { env, encoding: 'utf8' });
  try {
    const conflict = run(['-e', 'process.exit(0)', 'exec', '--last']);
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /--last.*managed/);

    const malformed = [
      'const fs=require("node:fs"),args=process.argv.slice(1),at=args.indexOf("-o");',
      'fs.writeFileSync(args[at+1],JSON.stringify({status:"complete",summary:"done"}));',
      'console.log("not JSONL")',
    ].join('');
    const invalid = run(['-e', malformed, 'exec']);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /Unexpected token|JSON/);
    assert.equal(existsSync(resultPath), false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
