/**
 * security-scan-core.ts — shared plumbing for scripts/security-scan.ts (docs/security-review.md): the scan
 * context, fail-closed errors, findings, and running a scanner with a minimal environment. Part of the gate:
 * exported from origin/main with the rest of GATE_FILES (scripts/security-gate.ts).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { accessSync, constants, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;
export const EXIT_HELD = 3;
// quality-ok: magic-number — named constant (exported): longest scanner message kept in a finding
export const MSG_MAX = 160;
// quality-ok: magic-number — named constant (exported): 1 GiB cap on captured scanner output
export const MAX_BUFFER = 1 << 30;

export interface Finding { id: string; tool: string; at: string; msg: string; hold: boolean }

/** A setup or scanner failure: the scan fails closed with exit 2. */
export class ScanError extends Error {}
export function die(msg: string): never { throw new ScanError(msg); }

export interface Ctx {
  root: string; cfg: string; tools: string; rules: string; mb: string; work: string;
  /** Paths added, copied, modified or renamed-to (what scanners read). */
  changed: string[];
  /** Every path the diff touches, deletions and both sides of renames included (what the gate holds). */
  touched: string[];
  findings: Finding[];
}

/**
 * The only parent variables a scanner sees: PATH, locale, temp dir, proxy and CA settings. Never tokens or
 * credentials, and HOME is a throwaway dir, so no scanner reads the user's dotfiles or credential stores.
 */
const PASS_THROUGH = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
  'NO_PROXY', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];

export function minimalEnv(c: Pick<Ctx, 'work'>, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const home = join(c.work, 'home');
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = { HOME: home };
  for (const k of PASS_THROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

export interface RunOpts { cwd: string; env: NodeJS.ProcessEnv }
export function run(cmd: string, args: string[], opts: RunOpts): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

/** git with the caller's environment (it reads only the repo under judgment, never runs its code). */
export function git(args: string[], cwd: string): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (r.status !== 0) die(`git ${args[0]} failed: ${lastLine(r.stderr)}`);
  return r.stdout;
}

export function lastLine(text: string | null): string {
  return (text ?? '').trim().split('\n').pop() ?? '';
}

export function parseJson(text: string, what: string): unknown {
  try { return JSON.parse(text); } catch { return die(`${what} wrote no valid report`); }
}

export function addFinding(c: Pick<Ctx, 'findings'>, f: Omit<Finding, 'hold'> & { hold?: boolean }): void {
  const finding = { ...f, hold: f.hold ?? false };
  c.findings.push(finding);
  console.log(`security-scan: ${finding.hold ? 'HOLD' : 'FINDING'} ${f.id} [${f.tool}] ${f.at} — ${f.msg}`);
}

/** 3 when anything is held, else 1 when anything was found, else 0. */
export function statusOf(findings: Finding[]): number {
  if (findings.some(f => f.hold)) return EXIT_HELD;
  return findings.length ? EXIT_FINDINGS : EXIT_CLEAN;
}

export function need(c: Pick<Ctx, 'tools'>, tool: string): string {
  const p = join(c.tools, tool);
  try { accessSync(p, constants.X_OK); } catch { die(`missing tool ${p} (run scripts/setup-security-tools.sh); failing closed`); }
  return p;
}

export function isFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}
