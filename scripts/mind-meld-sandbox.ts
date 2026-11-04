#!/usr/bin/env node
// Killable, offline Docker execution. Usage: imported by mind-meld.ts.
// No image pulls or repository writes. Temporary source snapshots are removed. The caller prepares a local image explicitly.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceHash } from './mind-meld-schema.ts';

export const MELD_IMAGE = 'node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94';
export const MELD_LIMIT_MS = 10_000;
const MAX_OUTPUT = 1_000_000;
const MILLISECONDS_PER_SECOND = 1000;

/** Only a local daemon can mount local code. Never inherit an external Docker context. */
export function dockerArgs(): string[] { return ['--host=unix:///var/run/docker.sock']; }

export function sandboxArgs(source: string, name: string, args: string[], timeoutMs = MELD_LIMIT_MS): string[] {
  const file = realpathSync(source);
  if (file.includes(',')) throw new Error('Docker bind path cannot contain commas');
  return [...dockerArgs(), 'run', '--rm', '--pull=never', '--name', name,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--pids-limit=32', '--memory=128m', '--cpus=1', '--user=65534:65534',
    '--tmpfs=/work:rw,noexec,nosuid,size=16m,mode=1777', '--workdir=/work',
    '--env=HOME=/work', '--env=HTTP_PROXY=', '--env=HTTPS_PROXY=', '--env=ALL_PROXY=',
    '--env=NO_PROXY=', '--env=no_proxy=', '--env=http_proxy=', '--env=https_proxy=', '--env=all_proxy=',
    '--mount', `type=bind,src=${file},dst=/app/example.ts,readonly`,
    MELD_IMAGE, 'timeout', '-s', 'KILL', String(Math.ceil(timeoutMs / MILLISECONDS_PER_SECOND)), 'node', '/app/example.ts', ...args];
}

function dockerEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
  return env;
}
function cleanupChild(name: string, env: NodeJS.ProcessEnv): Error | null {
  const result = spawnSync('docker', [...dockerArgs(), 'rm', '--force', name], { env, encoding: 'utf8', timeout: MELD_LIMIT_MS });
  if (result.error) return new Error(`Mind Meld child cleanup failed: ${result.error.message}`);
  if (result.status !== 0 && !result.stderr.includes('No such container:')) return new Error(`Mind Meld child cleanup failed: ${result.stderr}`);
  return null;
}
function snapshotSource(source: string, target: string, expectedHash: string | undefined): void {
  const bytes = readFileSync(source);
  if (expectedHash && sourceHash(bytes) !== expectedHash) throw new Error('source changed before execution');
  writeFileSync(target, bytes, { mode: 0o444 }); chmodSync(target, 0o444);
}
function executeChild(args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number }): string {
  const result = spawnSync('docker', args, { env: options.env, encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: MAX_OUTPUT, killSignal: 'SIGKILL' });
  if (result.error || result.status !== 0) throw new Error(`Mind Meld sandbox failed (no unsafe fallback): ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
/** The only container removed is this invocation's random named child. */
export function runSandbox(source: string, args: string[], timeoutMs = MELD_LIMIT_MS, expectedHash?: string): string {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MELD_LIMIT_MS) throw new Error('invalid timeout');
  const name = `mind-meld-${randomUUID()}`;
  const scratch = mkdtempSync(join(tmpdir(), 'mind-meld-'));
  const snapshot = join(scratch, 'example.ts');
  const env = dockerEnvironment();
  let error: Error | undefined;
  let output = '';
  try {
    snapshotSource(source, snapshot, expectedHash);
    output = executeChild(sandboxArgs(snapshot, name, args, timeoutMs), { env, timeoutMs });
  } catch (cause) { error = cause instanceof Error ? cause : new Error(String(cause)); }
  const cleanup = cleanupChild(name, env);
  rmSync(scratch, { recursive: true, force: true });
  if (cleanup) throw cleanup;
  if (error) throw error;
  return output;
}
