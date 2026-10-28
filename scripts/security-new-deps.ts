#!/usr/bin/env node
/**
 * security-new-deps.ts — hallucinated / typosquatted dependency guard (part of the security gate,
 * docs/security-review.md). AI-written code sometimes imports packages that do not exist,
 * or whose names an attacker has squatted. Every package NAME that a lockfile gains relative to the merge
 * base must exist on its public registry with real age and adoption; anything else is held for the owner
 * instead of merged.
 *
 *   node scripts/security-new-deps.ts --base <ref> [--] <lockfile...>
 *
 * Prints JSON {checked:[...], held:[{ecosystem,name,reason}]} on stdout.
 * Exit 0 all vouched for, 3 something held, 2 setup/network error (callers fail closed).
 * Supports Cargo.lock (crates.io) and package-lock.json (npm). Workspace/path packages are skipped;
 * git or non-default registry sources are always held.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIN_AGE_DAYS = 90;
const MIN_CRATE_DOWNLOADS = 10_000;    // all-time, crates.io
const MIN_NPM_WEEKLY = 1_000;          // last week, npm
const FETCH_TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;
const HTTP_NOT_FOUND = 404;
const MAX_LOCKFILE_BYTES = 256 << 20;
const EXIT_HELD = 3;
const EXIT_ERROR = 2;

export interface Dep { ecosystem: 'crates' | 'npm'; name: string; source: string; version?: string }

/** Registry packages a Cargo.lock names: crates.io entries plus any other remote source (held later). */
export function cargoDeps(text: string): Dep[] {
  const out: Dep[] = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/^\s*\[\[\s*package\s*\]\]\s*$/m).slice(1)) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const source = /^\s*source\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (!name) throw new Error('Cargo.lock [[package]] without a name: refusing to guess');
    if (source) out.push({ ecosystem: 'crates', name, source, version });   // no source = workspace/path
  }
  return out;
}

/** Registry packages a package-lock.json (v2/v3) names. */
export function npmDeps(text: string): Dep[] {
  const lock = JSON.parse(text) as { packages?: Record<string, { resolved?: string; link?: boolean }> };
  const out: Dep[] = [];
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    const i = path.lastIndexOf('node_modules/');
    if (i < 0 || meta.link) continue;
    out.push({ ecosystem: 'npm', name: path.slice(i + 'node_modules/'.length), source: meta.resolved ?? '' });
  }
  return out;
}

function depsOf(file: string, text: string): Dep[] {
  if (file.endsWith('Cargo.lock')) return cargoDeps(text);
  return file.endsWith('package-lock.json') ? npmDeps(text) : [];
}

/**
 * Where a package comes from, version aside: the crates.io index / npm registry, or the exact other source.
 * A known name that switches origin (registry → git, tarball URL or another host) is judged as new.
 */
export function origin(d: Dep): string {
  if (d.ecosystem === 'crates') return d.source.split('#')[0];
  return npmResolvedName(d.source) === d.name ? 'npm-registry' : d.source.replace(/#.*$/, '');
}

/** Name+origin pairs present at HEAD but not at base, per ecosystem (a version bump of a known one is not "new"). */
export function newDeps(head: Dep[], base: Dep[]): Dep[] {
  const key = (d: Dep) => `${d.ecosystem}:${d.name}\0${origin(d)}`;
  const known = new Set(base.map(key));
  const seen = new Set<string>();
  return head.filter(d => {
    const k = key(d);
    if (known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const HTTP_TOO_MANY = 429;
const RETRIES = 6;
const BACKOFF_MS = 2_000;
const MAX_WAIT_MS = 60_000;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

const MS_PER_SECOND = 1_000;

/** One GET, or null when it timed out / the connection failed (retried by `json`). */
async function get(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { headers: { 'User-Agent': 'scaffold-security-new-deps (security gate)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch { return null; }
}

/** GET a registry JSON document; null on 404. Rate limits (429), timeouts and dropped connections are retried
 *  with backoff a bounded number of times, then fail closed. */
async function json<T>(url: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const r = await get(url);
    if (r?.status === HTTP_NOT_FOUND) return null;
    if (retryable(r) && attempt < RETRIES) { await sleep(waitMs(r, attempt)); continue; }
    if (!r?.ok) throw new Error(`${url}: ${r ? `HTTP ${r.status}` : 'no response after retries'}`);
    return await r.json() as T;
  }
}

const retryable = (r: Response | null) => !r || r.status === HTTP_TOO_MANY;

/** The server's Retry-After when it sent one, else exponential backoff; capped. */
function waitMs(r: Response | null, attempt: number): number {
  const after = Number(r?.headers.get('retry-after')) * MS_PER_SECOND;
  return Math.min(after > 0 ? after : BACKOFF_MS * 2 ** attempt, MAX_WAIT_MS);
}

/** npm's naming rule (lowercase, url-safe, optional @scope/); anything else cannot be vouched for. */
export const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** The package a registry tarball URL actually serves: https://registry.npmjs.org/<name>/-/<file>.tgz */
export function npmResolvedName(resolved: string): string | null {
  const m = /^https:\/\/registry\.npmjs\.org\/((?:@[^/]+\/)?[^/@]+)\/-\/[^/]+\.tgz$/.exec(resolved);
  return m ? decodeURIComponent(m[1]) : null;
}

/** crates.io's exact lockfile source strings (a longer URL that merely starts with one is another registry). */
const CRATES_SOURCES = new Set(['registry+https://github.com/rust-lang/crates.io-index', 'sparse+https://index.crates.io/']);

async function judgeCrate(d: Dep, ageDays: (iso: string) => number): Promise<string> {
  if (!CRATES_SOURCES.has(d.source)) return `non-crates.io source ${d.source.split('#')[0]}`;
  // quality-ok: magic-number — crates.io's own crate-name length limit
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(d.name)) return `invalid crate name ${JSON.stringify(d.name)}`;
  const meta = await json<{ crate?: { created_at: string; downloads: number } }>(
    `https://crates.io/api/v1/crates/${encodeURIComponent(d.name)}`);
  if (!meta?.crate) return 'not found on crates.io (hallucinated or removed name)';
  const age = ageDays(meta.crate.created_at);
  if (age < MIN_AGE_DAYS) return `crate is only ${Math.floor(age)} days old`;
  if (meta.crate.downloads < MIN_CRATE_DOWNLOADS) return `only ${meta.crate.downloads} all-time downloads`;
  return '';
}

/** Offline checks: a valid name whose lockfile URL serves exactly that package. */
function npmShape(d: Dep): string {
  if (!NPM_NAME.test(d.name)) return `invalid npm name ${JSON.stringify(d.name)}`;
  if (!d.source) return 'no resolved registry URL in the lockfile';
  const served = npmResolvedName(d.source);
  return served === d.name ? '' : `lockfile key ${d.name} resolves to ${served ?? d.source} (name/package mismatch)`;
}

async function judgeNpm(d: Dep, ageDays: (iso: string) => number): Promise<string> {
  const shape = npmShape(d);
  if (shape) return shape;
  const enc = encodeURIComponent(d.name).replace('%40', '@');
  const meta = await json<{ time?: { created?: string } }>(`https://registry.npmjs.org/${enc}`);
  if (!meta?.time?.created) return 'not found on npm (hallucinated or removed name)';
  const age = ageDays(meta.time.created);
  if (age < MIN_AGE_DAYS) return `package is only ${Math.floor(age)} days old`;
  const dl = await json<{ downloads?: number }>(`https://api.npmjs.org/downloads/point/last-week/${enc}`);
  const weekly = dl?.downloads ?? 0;
  if (weekly < MIN_NPM_WEEKLY) return `only ${weekly} downloads last week`;
  return '';
}

/** Why `d` cannot be vouched for, or '' when it can. */
export async function judge(d: Dep, now = Date.now()): Promise<string> {
  const ageDays = (iso: string) => (now - Date.parse(iso)) / DAY_MS;
  return d.ecosystem === 'crates' ? judgeCrate(d, ageDays) : judgeNpm(d, ageDays);
}

function gitShow(ref: string, file: string): string {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`],
      { encoding: 'utf8', maxBuffer: MAX_LOCKFILE_BYTES, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--base');
  if (bi < 0 || !args[bi + 1]) throw new Error('usage: security-new-deps.ts --base <ref> [--] <lockfile...>');
  const base = args[bi + 1];
  const files = args.filter((a, i) => i !== bi && i !== bi + 1 && a !== '--');
  const checked: string[] = [];
  const held: { ecosystem: string; name: string; reason: string }[] = [];
  for (const file of files) {
    // The committed lockfile, not the working tree: tools run earlier in the scan can rewrite it.
    const head = depsOf(file, gitShow('HEAD', file) || readFileSync(file, 'utf8'));
    const baseText = gitShow(base, file);   // '' for a new lockfile: every package is new
    for (const d of newDeps(head, baseText ? depsOf(file, baseText) : [])) {
      const why = await judge(d);
      checked.push(`${d.ecosystem}:${d.name}`);
      if (why) held.push({ ecosystem: d.ecosystem, name: d.name, reason: why });
    }
  }
  console.log(JSON.stringify({ checked, held }, null, 2));
  process.exit(held.length ? EXIT_HELD : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((e: unknown) => { console.error(String(e)); process.exit(EXIT_ERROR); });
}
