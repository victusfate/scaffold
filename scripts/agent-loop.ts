#!/usr/bin/env node
// Portable external argv loop: lifecycle, status/logs, and durable steering.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { acknowledgeSteering, addSteering, alive, duration, EMPTY, initialize, location, pendingSteering, readConfig, readInbox, readProgress, save, stopRequest, withControlLock } from './agent-loop-state.ts';
import type { Config, SteeringOutcome } from './agent-loop-state.ts';
import { supervise } from './agent-loop-runner.ts';

const DEFAULT_FAILURES = 3;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const HANDSHAKE_POLL_MS = 25;
const MAX_LOG_BYTES = 64 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const OUTCOMES = new Set<SteeringOutcome>(['applied', 'deferred', 'blocked']);
interface Input { verb: string; options: Map<string, string>; argv: string[]; cancel: boolean; all: boolean; requireResult: boolean }

function allowedOptions(verb: string): string[] {
  if (verb === 'start') return ['--cwd', '--interval', '--timeout', '--lifetime', '--max-failures'];
  if (verb === 'steer') return ['--cwd', '--message', '--message-file'];
  if (verb === 'ack') return ['--cwd', '--id', '--outcome', '--note'];
  return verb === 'supervise' ? ['--state', '--generation'] : ['--cwd'];
}

function addOption(options: Map<string, string>, key: string, value: string | undefined, verb: string): void {
  if (!allowedOptions(verb).includes(key) || options.has(key) || !value) throw new Error(`Invalid option: ${key}`);
  options.set(key, value);
}

function parse(args: string[]): Input {
  const verb = args.shift() || '';
  if (!['start', 'status', 'stop', 'logs', 'steer', 'inbox', 'ack', 'supervise'].includes(verb)) throw new Error('Usage: agent-loop.ts start|status|stop|logs|steer|inbox|ack --cwd PATH [options] [-- CMD ARG...]');
  let argv: string[] = [];
  const options = new Map<string, string>();
  let cancel = false;
  let all = false;
  let requireResult = false;
  while (args.length) {
    const key = args.shift()!;
    if (key === '--') {
      if (verb !== 'start') throw new Error('Only start accepts command arguments');
      argv = args.splice(0);
      break;
    }
    if (key === '--cancel' && verb === 'stop' && !cancel) { cancel = true; continue; }
    if (key === '--all' && verb === 'inbox' && !all) { all = true; continue; }
    if (key === '--require-result' && verb === 'start' && !requireResult) { requireResult = true; continue; }
    addOption(options, key, args.shift(), verb);
  }
  if (verb !== 'start' && argv.length) throw new Error('Only start accepts command arguments');
  return { verb, options, argv, cancel, all, requireResult };
}

function configuration(input: Input, target: ReturnType<typeof location>): Config {
  const interval = duration(input.options.get('--interval') || '');
  const timeout = duration(input.options.get('--timeout') || '30min');
  const lifetime = duration(input.options.get('--lifetime') || '8h');
  const maxFailures = Number(input.options.get('--max-failures') || DEFAULT_FAILURES);
  if (!Number.isSafeInteger(maxFailures) || maxFailures < 1) throw new Error('max-failures must be a positive integer');
  if (!input.argv[0]) throw new Error('start requires -- CMD ARG...');
  if (/\.(cmd|bat)$/i.test(input.argv[0])) throw new Error('Command must be an executable, not a .cmd/.bat shell script');
  return { cwd: target.cwd, unit: target.unit, generation: randomUUID(), argv: input.argv,
    interval, timeout, expiresAt: Date.now() + lifetime, maxFailures, requireResult: input.requireResult };
}

function status(dir: string): object {
  const config = readConfig(dir);
  const progress = readProgress(dir);
  const live = alive(progress);
  const stopped = stopRequest(dir, config.generation);
  const pending = pendingSteering(dir, config.generation).length;
  return { ...config, ...progress, driver: 'node', armed: live && !stopped && Date.now() < config.expiresAt,
    supervisor: live ? 'active' : progress.ended ? 'stopped' : 'stale',
    running: live && progress.running, interrupted: !live && progress.running,
    stopRequested: !!stopped, pendingSteering: pending, log: join(dir, 'output.log') };
}

function message(input: Input): string {
  const inline = input.options.get('--message');
  const path = input.options.get('--message-file');
  if (!!inline === !!path) throw new Error('steer requires exactly one of --message or --message-file');
  const value = inline || readFileSync(path!, 'utf8');
  if (!value.trim() || Buffer.byteLength(value) > MAX_MESSAGE_BYTES) throw new Error('Steering message must be non-empty and at most 64 KiB');
  return value;
}

function activeConfig(dir: string): Config {
  const config = readConfig(dir);
  const progress = readProgress(dir);
  if (progress.generation !== config.generation || !alive(progress) || stopRequest(dir, config.generation) || Date.now() >= config.expiresAt) {
    throw new Error('Steering requires a live, non-stopping, unexpired loop');
  }
  return config;
}

async function steer(input: Input, dir: string): Promise<object> {
  const text = message(input);
  return withControlLock(dir, () => {
    const config = activeConfig(dir);
    const record = addSteering(dir, config.generation, text);
    const pending = pendingSteering(dir, config.generation).length;
    return { id: record.id, pending };
  });
}

async function inbox(input: Input, dir: string): Promise<object> {
  return withControlLock(dir, () => {
    const config = readConfig(dir);
    const records = input.all ? readInbox(dir) : pendingSteering(dir, config.generation);
    return input.all ? { records } : { generation: config.generation, pending: records };
  });
}

async function acknowledge(input: Input, dir: string): Promise<object> {
  const id = input.options.get('--id');
  const outcome = input.options.get('--outcome') as SteeringOutcome | undefined;
  const note = input.options.get('--note');
  if (!id || !outcome || !OUTCOMES.has(outcome)) throw new Error('ack requires --id and --outcome applied|deferred|blocked');
  if ((outcome === 'deferred' || outcome === 'blocked') && !note?.trim()) throw new Error('ack requires --note for deferred or blocked outcomes');
  return withControlLock(dir, () => {
    const config = readConfig(dir);
    const record = acknowledgeSteering(dir, { generation: config.generation, id, outcome, note });
    const pending = pendingSteering(dir, config.generation).length;
    return { id: record.id, outcome: record.outcome, pending };
  });
}

async function launch(config: Config, dir: string): Promise<void> {
  const lease = join(dir, 'supervisor.lock');
  mkdirSync(lease, { mode: 0o700 });
  const fd = openSync(join(dir, 'supervisor.log'), 'w', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'supervise', '--state', dir, '--generation', config.generation], {
    detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  let spawnError: Error | undefined;
  child.once('error', error => { spawnError = error; });
  child.unref();
  const deadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnError) { rmSync(lease, { recursive: true }); throw spawnError; }
    const progress = readProgress(dir);
    if (progress.generation === config.generation && progress.ready && alive(progress)) return;
    if (child.exitCode !== null) throw new Error('Supervisor exited before startup handshake; inspect supervisor.log');
    await delay(HANDSHAKE_POLL_MS);
  }
  save(dir, 'stopped.json', { generation: config.generation, cancel: true });
  throw new Error('Supervisor startup could not be verified; inspect supervisor.log and lease');
}

async function start(input: Input, target: ReturnType<typeof location>): Promise<object> {
  const config = configuration(input, target);
  initialize(target.dir);
  return withControlLock(target.dir, async () => {
    if (existsSync(join(target.dir, 'supervisor.lock'))) throw new Error('A loop already owns this checkout; a stale lease requires inspection, never automatic reclaim');
    if (existsSync(join(target.dir, 'config.json')) && pendingSteering(target.dir, readConfig(target.dir).generation).length) {
      throw new Error('Unacknowledged steering prevents restart; inspect inbox, preserve direction in the new handoff/prompt, then ack its disposition before starting');
    }
    save(target.dir, 'config.json', config);
    save(target.dir, 'progress.json', EMPTY);
    rmSync(join(target.dir, 'stopped.json'), { force: true });
    await launch(config, target.dir);
    return status(target.dir);
  });
}

async function stop(dir: string, cancel: boolean): Promise<void> {
  await withControlLock(dir, () => {
    const config = readConfig(dir);
    const progress = readProgress(dir);
    if (!alive(progress) && !progress.ended) throw new Error('Supervisor is stale; no process was signalled. Inspect its lease and logs');
    save(dir, 'stopped.json', { generation: config.generation, cancel: cancel || !!stopRequest(dir, config.generation)?.cancel });
  });
}

function logTail(dir: string): string {
  const log = join(dir, 'output.log');
  if (!existsSync(log)) return '';
  const fd = openSync(log, 'r');
  try {
    const size = fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, MAX_LOG_BYTES));
    const bytes = readSync(fd, buffer, 0, buffer.length, Math.max(0, size - MAX_LOG_BYTES));
    return buffer.subarray(0, bytes).toString('utf8');
  } finally { closeSync(fd); }
}

async function main(): Promise<void> {
  const input = parse(process.argv.slice(2));
  if (input.verb === 'supervise') {
    await supervise(input.options.get('--state') || '', input.options.get('--generation') || '');
    return;
  }
  const target = location(input.options.get('--cwd') || process.cwd());
  if (input.verb === 'start') { console.log(JSON.stringify(await start(input, target), null, 2)); return; }
  if (!existsSync(join(target.dir, 'config.json'))) throw new Error('No loop configured for this checkout');
  if (input.verb === 'stop') await stop(target.dir, input.cancel);
  if (input.verb === 'steer') { console.log(JSON.stringify(await steer(input, target.dir), null, 2)); return; }
  if (input.verb === 'inbox') { console.log(JSON.stringify(await inbox(input, target.dir), null, 2)); return; }
  if (input.verb === 'ack') { console.log(JSON.stringify(await acknowledge(input, target.dir), null, 2)); return; }
  const result = status(target.dir);
  console.log(JSON.stringify(input.verb === 'logs' ? { ...result, output: logTail(target.dir) } : result, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
