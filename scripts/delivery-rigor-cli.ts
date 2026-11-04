#!/usr/bin/env node
// Record a gate invocation or its evidence-backed adjudication. No shell evaluation.
// Usage: delivery-metrics.ts --record-stage NAME --unit ID --attempt N -- command args
import { appendFileSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readRigor, rigorMetrics, validateRecord, type RigorRecord } from './delivery-rigor.ts';

export function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0 && args.indexOf(name, index + 1) >= 0) throw new Error(`duplicate ${name}`);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}
/** Keep writes within cwd, including symlink parents. Explicit log reads may be elsewhere. */
function safeLog(path: string): string {
  const root = realpathSync(process.cwd());
  const target = resolve(path);
  const inside = (value: string) => { const p = relative(root, value); return p !== '..' && !p.startsWith('../') && !isAbsolute(p); };
  if (!inside(target)) throw new Error('rigor log writes must stay within cwd');
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(ancestor))) throw new Error('rigor log symlink leaves cwd');
  if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink() || lstatSync(target).nlink !== 1)) throw new Error('rigor log must be a regular file');
  return target;
}
function append(path: string, row: RigorRecord): void {
  safeLog(path);
  validateRecord(row);
  rigorMetrics([...readRigor(path), row]);
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { appendFileSync(fd, JSON.stringify(row) + '\n'); }
  finally { closeSync(fd); }
}
function record(args: string[], path: string): number {
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) throw new Error('record-stage requires -- command [args]');
  const flags = args.slice(0, separator);
  const startedAt = new Date().toISOString();
  const row = validateRecord({ kind: 'attempt', id: randomUUID(), stage: option(flags, '--record-stage'),
    unit: option(flags, '--unit'), attempt: Number(option(flags, '--attempt')), startedAt,
    durationMs: 0, outcome: 'failed' });
  // Refuse malformed/duplicate metadata before the command can mutate anything.
  rigorMetrics([...readRigor(path), row]);
  mkdirSync(dirname(path), { recursive: true });
  const start = performance.now();
  const result = spawnSync(args[separator + 1], args.slice(separator + 2), { stdio: 'inherit' });
  const outcome = result.status === 0 && !result.error && !result.signal ? 'passed' : 'failed';
  append(path, { ...row, durationMs: performance.now() - start, outcome } as RigorRecord);
  console.error(`rigor attempt: ${row.id} (${outcome})`);
  if (result.error) console.error(result.error.message);
  return result.error || result.signal ? 1 : result.status ?? 1;
}
export function rigorAction(args: string[], path: string): number | null {
  const separator = args.indexOf('--');
  const flags = separator < 0 ? args : args.slice(0, separator);
  if (!flags.includes('--record-stage') && !flags.includes('--review-stage')) return null;
  const target = safeLog(path);
  if (flags.includes('--record-stage') && flags.includes('--review-stage')) throw new Error('choose record-stage or review-stage');
  if (flags.includes('--record-stage')) return record(args, target);
  const hasFalsePositive = flags.includes('--false-positive');
  if (hasFalsePositive === flags.includes('--true-positive')) throw new Error('review needs exactly one of --false-positive or --true-positive');
  append(target, validateRecord({ kind: 'review', id: option(flags, '--review-stage'), falsePositive: hasFalsePositive,
    evidence: option(flags, '--evidence') }));
  console.log(`rigor review recorded for ${option(flags, '--review-stage') ?? ''}`);
  return 0;
}
