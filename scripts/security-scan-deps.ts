/**
 * security-scan-deps.ts — dependency checks of scripts/security-scan.ts: cargo-deny on an isolated copy of HEAD,
 * the new-dependency guard, holds for lockfiles the guard cannot parse, and the project-check extension point.
 * Part of the gate: exported from origin/main with the rest of GATE_FILES.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { type Ctx, EXIT_CLEAN, EXIT_HELD, MSG_MAX, addFinding, die, isFile, lastLine, minimalEnv, need, parseJson,
  run } from './security-scan-core.ts';

/** Lockfiles security-new-deps.ts reads (osv-scanner also judges these and the next list's pip/go/poetry ones). */
export const GUARDED_LOCKFILE = /(^|\/)(Cargo\.lock|package-lock\.json)$/;
/** Lockfiles osv-scanner judges for known vulnerabilities. */
export const OSV_LOCKFILE = /(^|\/)(Cargo\.lock|package-lock\.json|requirements[^/]*\.txt|poetry\.lock|go\.sum)$/;
/** Lockfiles the new-dependency guard cannot parse: any change to one is held for the owner's sign-off. */
export const UNPARSED_LOCKFILE =
  /(^|\/)(yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|uv\.lock|Pipfile\.lock|Gemfile\.lock|poetry\.lock|go\.sum|requirements[^/]*\.txt)$/;

// 4a. A lockfile change the new-dependency guard cannot vet: held until the owner signs off on the ack line.
export function holdUnparsedLockfiles(c: Ctx): void {
  for (const p of c.touched.filter(f => UNPARSED_LOCKFILE.test(f))) {
    addFinding(c, { id: `lockfile:${p}`, tool: 'new-deps', at: p, hold: true,
      msg: "the new-dependency guard cannot parse this lockfile — needs the owner's sign-off" });
  }
}

/** Every `.cargo/` dir and `rust-toolchain[.toml]` file under `dir`: branch-controlled cargo configuration. */
export function cargoConfigPaths(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(p => ['.cargo', 'rust-toolchain', 'rust-toolchain.toml'].includes(basename(p)))
    .map(p => join(dir, p));
}

/** An exported copy of HEAD without its cargo configuration, and an isolated CARGO_HOME with the registry cache. */
function isolatedCrateTree(c: Ctx): { src: string; cargoHome: string } {
  const src = join(c.work, 'cargo-src');
  const cargoHome = join(c.work, 'cargo-home');
  mkdirSync(src, { recursive: true });
  const tar = join(c.work, 'head.tar');
  if (spawnSync('git', ['archive', '--format=tar', '-o', tar, 'HEAD'], { cwd: c.root }).status !== 0) die('cannot export HEAD for cargo-deny');
  if (spawnSync('tar', ['-xf', tar, '-C', src]).status !== 0) die('cannot unpack HEAD for cargo-deny');
  for (const p of cargoConfigPaths(src)) rmSync(p, { recursive: true, force: true });
  // Offline resolution needs the crates.io index and crate archives; copy (never link) only those two caches.
  const userRegistry = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'registry');
  for (const part of ['index', 'cache']) {
    if (existsSync(join(userRegistry, part))) cpSync(join(userRegistry, part), join(cargoHome, 'registry', part), { recursive: true });
  }
  return { src, cargoHome };
}

interface DenyLine { type?: string; fields?: { severity?: string; level?: string; code?: string; message?: string } }

/** cargo-deny's JSON lines: error diagnostics (policy findings) and error logs (the tool itself failed). */
export function denyOutcome(stderr: string): { errors: DenyLine[]; crashed: string } {
  const lines = stderr.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) as DenyLine; } catch { return {}; } });
  const errors = lines.filter(l => l.type === 'diagnostic' && l.fields?.severity === 'error');
  const crash = lines.find(l => l.type === 'log' && l.fields?.level === 'ERROR');
  return { errors, crashed: crash ? (crash.fields?.message ?? 'error').split('\n')[0] : '' };
}

// 4b. Rust crate sources, when Rust manifests change. cargo-deny runs `cargo metadata`, which honours the tree's
//     .cargo/config.toml (rustc-wrapper, credential providers, source replacement) and rust-toolchain files, so it
//     judges an exported copy of HEAD with those removed, an isolated CARGO_HOME, no wrapper, offline and locked.
export function scanCrates(c: Ctx): void {
  const deny = need(c, 'cargo-deny');
  const conf = join(c.cfg, 'deny.toml');
  if (!existsSync(conf)) die(`no deny.toml in ${c.cfg}; failing closed`);
  const { src, cargoHome } = isolatedCrateTree(c);
  const env = minimalEnv(c, { CARGO_HOME: cargoHome, RUSTC_WRAPPER: '', RUSTC_WORKSPACE_WRAPPER: '', CARGO_NET_OFFLINE: 'true',
    RUSTUP_HOME: process.env.RUSTUP_HOME || join(homedir(), '.rustup') });
  const r = run(deny, ['--log-level', 'error', '--format', 'json', '--frozen', '--config', conf,
    '--manifest-path', join(src, 'Cargo.toml'), 'check', 'sources', 'bans'], { cwd: src, env });
  const { errors, crashed } = denyOutcome(r.stderr);
  if (crashed) die(`cargo-deny could not run: ${crashed.slice(0, MSG_MAX)}`);
  if (r.status !== 0 && !errors.length) die(`cargo-deny exited ${r.status} without a diagnostic: ${lastLine(r.stderr)}`);
  for (const code of [...new Set(errors.map(e => e.fields?.code ?? 'error'))]) {
    const msg = errors.find(e => (e.fields?.code ?? 'error') === code)?.fields?.message ?? '';
    addFinding(c, { id: `cargo-deny:${code}`, tool: 'cargo-deny', at: 'Cargo.lock', msg: msg.slice(0, MSG_MAX) });
  }
}

// 6. New dependency names must be real, aged and adopted (hallucinated / typosquat guard).
export function scanNewDeps(c: Ctx, locks: string[]): void {
  const guard = join(c.cfg, 'scripts/security-new-deps.ts');
  if (!existsSync(guard)) die(`no security-new-deps.ts in ${c.cfg}; failing closed`);
  const r = run(process.execPath, [guard, '--base', c.mb, '--', ...locks], { cwd: c.root, env: minimalEnv(c) });
  if (r.status !== EXIT_CLEAN && r.status !== EXIT_HELD) die(`new-dependency guard exited ${r.status}: ${lastLine(r.stderr)}`);
  const out = parseJson(r.stdout, 'new-dependency guard') as { checked?: unknown; held?: { ecosystem: string; name: string; reason: string }[] } | null;
  if (!Array.isArray(out?.checked)) die('new-dependency guard wrote no valid report');
  for (const h of out.held ?? []) {
    addFinding(c, { id: `newdep:${h.ecosystem}:${h.name}`, tool: 'new-deps', at: 'lockfile',
      msg: `${h.reason} — needs an owner decision`, hold: true });
  }
}

/**
 * 8. Project checks — the extension point. Each file in <config-dir>/security/checks/ (exported from origin/main
 * like the rest of the gate) runs with cwd = the repo, args `--base <merge-base> -- <changed paths...>` and a
 * minimal environment plus SECURITY_TOOLS_DIR; `.ts` files run with node, anything else must be executable. It
 * prints a JSON array of {id, at, msg} on stdout and exits 0; any other exit or output fails the scan closed.
 * Findings are recorded as `check:<file>:<id>` and are acknowledged like any other finding.
 */
export function runProjectChecks(c: Ctx): void {
  const dir = join(c.cfg, 'security/checks');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort().filter(n => isFile(join(dir, n)))) {
    const file = join(dir, name);
    const [cmd, args] = name.endsWith('.ts') ? [process.execPath, [file]] : [file, []];
    const r = run(cmd, [...args, '--base', c.mb, '--', ...c.changed], { cwd: c.root, env: minimalEnv(c, { SECURITY_TOOLS_DIR: c.tools }) });
    if (r.status !== 0) die(`project check ${name} exited ${r.status}: ${lastLine(r.stderr)}`);
    const out = parseJson(r.stdout, `project check ${name}`);
    if (!Array.isArray(out)) die(`project check ${name} wrote no JSON array`);
    for (const f of out as { id: string; at?: string; msg?: string }[]) {
      addFinding(c, { id: `check:${name}:${f.id}`, tool: name, at: f.at ?? '?', msg: f.msg ?? '' });
    }
  }
}
