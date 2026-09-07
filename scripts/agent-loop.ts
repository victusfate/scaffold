#!/usr/bin/env node
// Schedule bounded argv commands with systemd: start, status, stop, and logs.
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { duration, EMPTY, initialize, location, readConfig, readProgress, save, withControlLock } from './agent-loop-state.ts';
import type { Config } from './agent-loop-state.ts';
import { arm, available, busy, control, unitState } from './agent-loop-systemd.ts';
import { finish, run } from './agent-loop-runner.ts';

const DEFAULT_FAILURES = 3;
interface Input { verb: string; options: Map<string, string>; argv: string[]; cancel: boolean }

function allowedOptions(verb: string): string[] {
  if (verb === 'start') return ['--cwd', '--interval', '--timeout', '--lifetime', '--max-failures'];
  return verb.startsWith('timer-') ? ['--state', '--generation'] : ['--cwd'];
}

function addOption(options: Map<string, string>, key: string, value: string | undefined, verb: string): void {
  if (!allowedOptions(verb).includes(key) || options.has(key) || !value) throw new Error(`Invalid option: ${key}`);
  options.set(key, value);
}

function parse(args: string[]): Input {
  const verb = args.shift() || '';
  if (!['start', 'status', 'stop', 'logs', 'timer-run', 'timer-finish'].includes(verb)) {
    throw new Error('Usage: agent-loop.ts start|status|stop|logs --cwd PATH [options] [-- CMD ARG...]');
  }
  const separator = args.indexOf('--');
  const argv = separator < 0 ? [] : args.splice(separator).slice(1);
  const options = new Map<string, string>();
  let cancel = false;
  while (args.length) {
    const key = args.shift()!;
    if (key === '--cancel' && verb === 'stop' && !cancel) { cancel = true; continue; }
    addOption(options, key, args.shift(), verb);
  }
  if (verb !== 'start' && argv.length) throw new Error('Only start accepts command arguments');
  return { verb, options, argv, cancel };
}

function configuration(input: Input, target: ReturnType<typeof location>): Config {
  const interval = duration(input.options.get('--interval') || '');
  const timeout = duration(input.options.get('--timeout') || '30min');
  const lifetime = duration(input.options.get('--lifetime') || '8h');
  const maxFailures = Number(input.options.get('--max-failures') || DEFAULT_FAILURES);
  if (!Number.isSafeInteger(maxFailures) || maxFailures < 1) throw new Error('max-failures must be a positive integer');
  if (!input.argv[0]) throw new Error('start requires -- CMD ARG...');
  return { cwd: target.cwd, unit: target.unit, generation: randomUUID(), argv: input.argv,
    path: process.env.PATH || '', interval, timeout, expiresAt: Date.now() + lifetime, maxFailures };
}

function status(dir: string): object {
  const config = readConfig(dir);
  const timer = unitState(`${config.unit}.timer`);
  const service = unitState(`${config.unit}.service`);
  const progress = readProgress(dir);
  if (progress.running && !busy(service)) {
    progress.failures++;
    progress.running = false;
    progress.outcome = 'previous run timed out or crashed';
  }
  return { ...config, timer, service, armed: timer === 'active',
    expired: Date.now() >= config.expiresAt, ...progress,
    stop: existsSync(join(dir, 'stopped.json')) ? JSON.parse(readFileSync(join(dir, 'stopped.json'), 'utf8')) as unknown : null,
    log: join(dir, 'output.log') };
}

function start(input: Input, target: ReturnType<typeof location>): object {
  const config = configuration(input, target);
  available();
  initialize(target.dir);
  return withControlLock(target.dir, () => { try {
    if (busy(unitState(`${target.unit}.timer`)) || busy(unitState(`${target.unit}.service`))) throw new Error('A loop already exists for this checkout');
    if (existsSync(join(target.dir, 'config.json')) && readConfig(target.dir).cwd !== target.cwd) throw new Error('State ownership mismatch');
    save(target.dir, 'config.json', config);
    save(target.dir, 'progress.json', EMPTY);
    rmSync(join(target.dir, 'stopped.json'), { force: true });
    arm(config, target.dir, fileURLToPath(import.meta.url));
    return status(target.dir);
  } catch (error) {
    // Only clean up units created by this start, never an existing active loop.
    if (existsSync(join(target.dir, 'config.json')) && readConfig(target.dir).generation === config.generation) {
      save(target.dir, 'stopped.json', { reason: 'start failed' });
      control(['stop', `${target.unit}.timer`], true);
    }
    throw error;
  } });
}

function stop(target: ReturnType<typeof location>, cancel: boolean): void {
  withControlLock(target.dir, () => {
    save(target.dir, 'stopped.json', { reason: cancel ? 'cancelled' : 'user stop' });
    if (busy(unitState(`${target.unit}.timer`))) control(['stop', `${target.unit}.timer`]);
    if (cancel && busy(unitState(`${target.unit}.service`))) control(['stop', `${target.unit}.service`]);
    if (busy(unitState(`${target.unit}.timer`))) throw new Error('Timer did not stop');
  });
}

function logTail(dir: string): string {
  const log = join(dir, 'output.log');
  if (!existsSync(log)) return '';
  const fd = openSync(log, 'r');
  const maxBytes = 64 * 1024;
  try {
    const size = fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const bytes = readSync(fd, buffer, 0, buffer.length, Math.max(0, size - maxBytes));
    return buffer.subarray(0, bytes).toString('utf8');
  } finally { closeSync(fd); }
}

async function main(): Promise<void> {
  const input = parse(process.argv.slice(2));
  if (input.verb === 'timer-finish') {
    finish(input.options.get('--state') || '', input.options.get('--generation') || '');
    return;
  }
  if (input.verb === 'timer-run') {
    await run(input.options.get('--state') || '', input.options.get('--generation') || '');
    return;
  }
  const target = location(input.options.get('--cwd') || process.cwd());
  if (input.verb === 'start') { console.log(JSON.stringify(start(input, target), null, 2)); return; }
  available();
  if (!existsSync(join(target.dir, 'config.json'))) throw new Error('No loop configured for this checkout');
  if (input.verb === 'stop') stop(target, input.cancel);
  const result = status(target.dir);
  if (input.verb === 'logs') {
    console.log(JSON.stringify({ ...result, output: logTail(target.dir) }, null, 2));
  } else console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
