#!/usr/bin/env node
// Behavioral checks for measured gate costs and explicit false-positive adjudication.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { rigorMetrics, readRigor, formatRigor, type GateAttempt } from './delivery-rigor.ts';

const at = '2026-11-04T12:00:00.000Z';
const attempt = (id: string, stage: string, durationMs: number, outcome: 'passed' | 'failed'): GateAttempt =>
  ({ kind: 'attempt', id, unit: 'task-1', stage, attempt: 1, startedAt: at, durationMs, outcome });
const rows = [attempt('a', 'security', 120_000, 'failed'), { ...attempt('b', 'security', 60_000, 'passed'), attempt: 2 },
  { ...attempt('c', 'lint', 60_000, 'passed'), unit: 'task-2' },
  { ...attempt('d', 'security', 180_000, 'failed'), unit: 'task-3' }];
const reviews = [{ kind: 'review' as const, id: 'a', falsePositive: true, evidence: 'parser rejects valid fixture; verified minimized input' }];
const m = rigorMetrics([...rows, ...reviews]);
assert.deepEqual(m.stages.find(s => s.stage === 'security'), {
  stage: 'security', minutes: 6, attempts: 3, firstTries: 2, firstTryPassed: 0,
  failures: 2, reviewedFailures: 1, falsePositives: 1,
});
assert.equal(m.daily[0].date, '2026-11-04');
assert.deepEqual(m.daily[0].gates.map(s => s.stage), ['security', 'lint']);
assert.match(formatRigor(m), /security: 6\.0m/);
assert.match(formatRigor(m), /operational signals, not customer success/);
assert.match(formatRigor(m), /Outcome\/risk\/learning evidence: not measured here/);
assert.match(formatRigor(m), /false-positive 100\.0%.*1\/2 failures reviewed/);
assert.match(formatRigor(rigorMetrics([])), /no gate attempts recorded/);
assert.throws(() => rigorMetrics([rows[0], rows[0]]), /duplicate/);
assert.throws(() => rigorMetrics([{ ...rows[0], durationMs: -1 }]), /duration/);
assert.throws(() => rigorMetrics([{ ...rows[0], attempt: 0 }]), /attempt/);
assert.throws(() => rigorMetrics([{ ...rows[0], startedAt: 'tomorrow' }]), /timestamp/);
assert.throws(() => rigorMetrics([{ ...rows[0], startedAt: '2026-02-30T00:00:00.000Z' }]), /timestamp/);
assert.throws(() => rigorMetrics([{ ...rows[0], outcome: 'skipped' }]), /outcome/);
assert.throws(() => rigorMetrics([{ ...rows[0], unexpected: true }]), /unknown/);
assert.throws(() => rigorMetrics([rows[0], { ...reviews[0], evidence: '' }]), /evidence/);
assert.throws(() => rigorMetrics([reviews[0]]), /unknown attempt/);
assert.throws(() => rigorMetrics([rows[1], { ...reviews[0], id: 'b' }]), /failed/);
assert.throws(() => rigorMetrics([rows[0], reviews[0], reviews[0]]), /duplicate review/);
const dir = mkdtempSync(join(tmpdir(), 'delivery-rigor-'));
const log = join(dir, 'gate.jsonl');
const cli = resolve('scripts/delivery-metrics.ts');
function run(args: string[], logPath = log) { return spawnSync(process.execPath, [cli, '--rigor-log', logPath, ...args], { encoding: 'utf8', cwd: dir }); }
try {
  assert.deepEqual(readRigor(log), []);
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: node scripts\/delivery-metrics.ts/);
  assert.equal(run(['--unknown']).status, 2);
  assert.equal(run(['--attempt', '1']).status, 2);
  assert.equal(run(['--rigor-log']).status, 2);
  assert.equal(run(['--record-stage', 'lint', '--unit', 'escape', '--attempt', '1', '--', process.execPath, '-e', 'process.exit(0)'], '../outside.jsonl').status, 2);
  symlinkSync(tmpdir(), join(dir, 'escape'));
  assert.equal(run(['--record-stage', 'lint', '--unit', 'escape', '--attempt', '1', '--', process.execPath, '-e', 'process.exit(0)'], 'escape/outside.jsonl').status, 2);
  const passed = run(['--record-stage', 'lint', '--unit', 'task-1', '--attempt', '1', '--', process.execPath, '-e', 'process.exit(0)']);
  assert.equal(passed.status, 0, passed.stderr);
  const failed = run(['--record-stage', 'lint', '--unit', 'task-2', '--attempt', '1', '--', process.execPath, '-e', 'process.exit(7)']);
  assert.equal(failed.status, 7, failed.stderr);
  const entries = readRigor(log);
  assert.equal(entries.length, 2);
  const failedEntry = entries[1] as GateAttempt;
  assert.equal(failedEntry.outcome, 'failed');
  assert.equal(run(['--review-stage', failedEntry.id, '--false-positive', '--evidence', 'reviewed failing assertion']).status, 0);
  assert.equal(readRigor(log).length, 3);
  assert.equal(run(['--review-stage', failedEntry.id, '--false-positive', '--evidence', 'duplicate']).status, 2);
  const report = run(['--local-only']);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /first-try 50\.0%/);
  assert.match(report.stdout, /Daily gate cost/);
  assert.equal(run(['--record-stage', 'lint', '--unit', 'bad', '--attempt', '0', '--', process.execPath, '-e', 'process.exit(0)']).status, 2);
  writeFileSync(log, readFileSync(log, 'utf8') + '{broken\n');
  assert.throws(() => readRigor(log), /line 4/);
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('delivery-rigor.test: ok');
