#!/usr/bin/env node
/**
 * security-scan.ts — third-party security scanners over a merge diff: the machine half of the security
 * gate (docs/security-review.md). Runs inside scripts/security-gate.ts before every
 * merge, and on demand. Deterministic: the line-by-line review is the human half, checked by the gate.
 *
 *   node scripts/security-scan.ts [--base <ref>] [--report <file.json>] [--config-dir <dir>]
 *     --base        compare HEAD against this ref (default origin/main); only the diff is judged
 *     --report      write a JSON summary {status, findings:[{id,tool,at,msg,hold}]}
 *     --config-dir  where .gitleaks.toml, .semgrep/, deny.toml, security/checks/, security-rules.sha256 and
 *                   security-new-deps.ts come from. The gate passes a copy exported from origin/main, so a
 *                   branch can never weaken the gate that judges it. Default: the repo being scanned.
 * Exit: 0 clean, 1 findings, 2 setup/scanner error (fails closed), 3 new dependencies or gate changes held.
 *
 * Tools (pinned installs from scripts/setup-security-tools.sh in $SECURITY_TOOLS_DIR, default
 * <main checkout>/.tooling/security/bin): gitleaks, semgrep, osv-scanner, cargo-deny, zizmor.
 * Semgrep rule packs come from $SECURITY_RULES_DIR (default <main checkout>/.tooling/security/rules) and
 * must match the tracked scripts/security-rules.sha256 on every scan.
 * Extension point: every file in <config-dir>/security/checks/ is a project check (see runProjectChecks).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GATE_FILES } from './security-gate.ts';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;
export const EXIT_HELD = 3;


const SAST_EXT = /\.(rs|ts|tsx|js|jsx|mjs|cjs|py|sh|go|rb|java|toml|ya?ml|json)$/;
const LOCKFILE = /(^|\/)(Cargo\.lock|package-lock\.json|requirements[^/]*\.txt|poetry\.lock|go\.sum)$/;
const CARGO_MANIFEST = /(^|\/)Cargo\.(toml|lock)$/;
const WORKFLOW = /^\.github\/workflows\//;
const MSG_MAX = 160;
const ERR_TYPE_MAX = 40;
const MAX_BUFFER = 1 << 30;

export interface Finding { id: string; tool: string; at: string; msg: string; hold: boolean }

/** A setup or scanner failure: the scan fails closed with exit 2. */
export class ScanError extends Error {}
function die(msg: string): never { throw new ScanError(msg); }

interface Ctx {
  root: string; cfg: string; tools: string; rules: string; mb: string; work: string;
  changed: string[]; findings: Finding[];
}

interface RunOpts { cwd: string; env?: NodeJS.ProcessEnv }
function run(cmd: string, args: string[], opts: RunOpts): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

function git(args: string[], cwd: string): string {
  const r = run('git', args, { cwd });
  if (r.status !== 0) die(`git ${args[0]} failed: ${lastLine(r.stderr)}`);
  return r.stdout;
}

function lastLine(text: string | null): string {
  return (text ?? '').trim().split('\n').pop() ?? '';
}

function parseJson(text: string, what: string): unknown {
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

function need(c: Ctx, tool: string): string {
  const p = join(c.tools, tool);
  try { accessSync(p, constants.X_OK); } catch { die(`missing tool ${p} (run scripts/setup-security-tools.sh); failing closed`); }
  return p;
}

function isFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}

/** A changed path is a gate file when it is one, or lies inside a gate directory. */
export function isGatePath(p: string): boolean {
  return GATE_FILES.some(g => p === g || p.startsWith(`${g}/`));
}

// 0. The gate's own files and the dependency approvals change only with the owner's sign-off (otherwise one PR
//    could loosen the gate or pre-approve a dependency for the next).
function checkGateChanges(c: Ctx): void {
  for (const p of c.changed.filter(isGatePath)) {
    addFinding(c, { id: `gate-change:${p}`, tool: 'gate', at: p,
      msg: "changes the security gate or its approvals — needs the owner's sign-off", hold: true });
  }
}

// 1. Secrets in the commits being merged (values redacted, never printed).
function scanSecrets(c: Ctx): void {
  const gitleaks = need(c, 'gitleaks');
  const report = join(c.work, 'gitleaks.json');
  const conf = join(c.cfg, '.gitleaks.toml');
  const args = ['git', '--redact', '--no-banner', ...(existsSync(conf) ? ['--config', conf] : []), '--exit-code', '0',
    `--log-opts=${c.mb}..HEAD`, '--report-format', 'json', '--report-path', report, '.'];
  const r = run(gitleaks, args, { cwd: c.root });
  if (r.status !== 0) die(`gitleaks failed: ${lastLine(r.stdout + r.stderr)}`);
  const rows = existsSync(report) ? parseJson(readFileSync(report, 'utf8'), 'gitleaks') : null;
  if (!Array.isArray(rows)) die('gitleaks wrote no valid report');
  for (const s of rows as { RuleID: string; File: string; StartLine: number; Fingerprint: string }[]) {
    addFinding(c, { id: `secret:${s.Fingerprint}`, tool: 'gitleaks', at: `${s.File}:${s.StartLine}`,
      msg: `${s.RuleID} (value redacted)` });
  }
}

/** `<sha256>  ./<pack>` lines of the tracked checksum file. */
export function rulePacks(sums: string): { hash: string; name: string }[] {
  return sums.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [hash, file] = l.split(/\s+/);
    return { hash, name: (file ?? '').replace(/^\*?\.\//, '') };
  });
}

// Exactly the rule packs the TRACKED checksum file lists, verified every scan (an extra or changed pack is not used).
function semgrepConfigs(c: Ctx): string[] {
  const sumsFile = join(c.cfg, 'scripts/security-rules.sha256');
  if (!existsSync(sumsFile)) die(`no scripts/security-rules.sha256 in ${c.cfg}; failing closed`);
  const packs = rulePacks(readFileSync(sumsFile, 'utf8'));
  if (!packs.length) die('no pinned semgrep rule packs listed; failing closed');
  const configs: string[] = [];
  for (const { hash, name } of packs) {
    const file = join(c.rules, name);
    const actual = isFile(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : '';
    if (!name || actual !== hash) die(`semgrep rule packs in ${c.rules} differ from the tracked checksums; failing closed`);
    configs.push('--config', file);
  }
  const repoRules = join(c.cfg, '.semgrep');
  if (existsSync(repoRules)) configs.push('--config', repoRules);
  return configs;
}

interface SemgrepOut {
  results: { check_id: string; path: string; start: { line: number }; extra: { severity: string; message: string } }[];
  errors?: { type?: unknown; path?: string; spans?: { file?: string }[] }[];
}

/** A semgrep error's type, reduced to an id-safe token. */
export function errorType(type: unknown): string {
  const t = Array.isArray(type) ? (type as unknown[])[0] : type;
  const s = typeof t === 'string' ? t : JSON.stringify(t ?? null);
  return s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, ERR_TYPE_MAX);
}

function reportSemgrep(c: Ctx, out: SemgrepOut): void {
  for (const r of out.results.filter(x => x.extra.severity !== 'INFO')) {
    const at = `${r.path}:${r.start.line}`;
    const msg = r.extra.message.replace(/\s+/g, ' ').slice(0, MSG_MAX);
    addFinding(c, { id: `sast:${r.check_id.split('.').pop()}@${at}`, tool: 'semgrep', at, msg: `[${r.extra.severity}] ${msg}` });
  }
  // A file semgrep could not parse was not scanned: that is a finding, not a pass.
  for (const e of out.errors ?? []) {
    const path = e.path ?? e.spans?.[0]?.file ?? '?';
    const type = errorType(e.type);
    addFinding(c, { id: `sast-error:${type}@${path}`, tool: 'semgrep', at: path,
      msg: `semgrep could not fully scan this file (${type})` });
  }
}

// 2. SAST on changed source files: findings this diff introduces (baseline = merge base).
function scanSast(c: Ctx): void {
  const semgrep = need(c, 'semgrep');
  const configs = semgrepConfigs(c);
  const src = c.changed.filter(p => SAST_EXT.test(p) && isFile(join(c.root, p))).map(p => `./${p}`);   // ./ : never an option
  if (!src.length) return;
  const r = run(semgrep, ['scan', '--metrics=off', '--disable-version-check', '--quiet', '--json',
    '--baseline-commit', c.mb, ...configs, '--', ...src], { cwd: c.root, env: { ...process.env, SEMGREP_SEND_METRICS: 'off' } });
  if (r.status !== EXIT_CLEAN && r.status !== EXIT_FINDINGS) die(`semgrep exited ${r.status}: ${lastLine(r.stderr)}`);
  const out = parseJson(r.stdout, 'semgrep') as SemgrepOut | null;
  if (!Array.isArray(out?.results)) die('semgrep wrote no valid results');
  reportSemgrep(c, out);
}

interface OsvOut { results: { packages?: { package: { name: string; version: string }; vulnerabilities?: { id: string }[] }[] }[] }

/** Vulnerable `name@version\tid` keys of one lockfile, or die. */
function osvIds(c: Ctx, lockCopy: string): Set<string> {
  const r = run(need(c, 'osv-scanner'), ['scan', 'source', '--lockfile', lockCopy, '--format', 'json'], { cwd: c.root });
  if (r.status !== EXIT_CLEAN && r.status !== EXIT_FINDINGS) die(`osv-scanner exited ${r.status} on ${lockCopy}: ${lastLine(r.stderr)}`);
  const out = parseJson(r.stdout, 'osv-scanner') as OsvOut | null;
  if (!Array.isArray(out?.results)) die(`osv-scanner wrote no valid results for ${lockCopy}`);
  const ids = new Set<string>();
  for (const p of out.results.flatMap(x => x.packages ?? [])) {
    for (const v of p.vulnerabilities ?? []) ids.add(`${p.package.name}@${p.package.version}\t${v.id}`);
  }
  return ids;
}

/** Writes `<ref>:<lock>` under work/<side>/ and returns the copy's path, or '' when the ref lacks it. */
function lockAt(c: Ctx, ref: string, lock: string): string {
  const r = spawnSync('git', ['show', `${ref}:${lock}`], { cwd: c.root, maxBuffer: MAX_BUFFER });
  if (r.status !== 0) return '';
  const side = ref === 'HEAD' ? 'head' : 'base';
  const copy = join(c.work, side, lock);
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(copy, r.stdout);
  return copy;
}

// 3. Known-vulnerable dependencies the diff introduces (lockfiles at HEAD vs the merge base).
function scanVulns(c: Ctx, locks: string[]): void {
  for (const lock of locks) {
    const head = lockAt(c, 'HEAD', lock) || die(`cannot read HEAD:${lock}`);   // the committed lockfile
    const headIds = osvIds(c, head);
    const base = lockAt(c, c.mb, lock);
    const baseIds = base ? osvIds(c, base) : new Set<string>();
    for (const key of [...headIds].filter(k => !baseIds.has(k)).sort()) {
      const [pkg, id] = key.split('\t');
      addFinding(c, { id: `vuln:${id}:${pkg}`, tool: 'osv-scanner', at: lock, msg: `${pkg} is affected by ${id} (new in this diff)` });
    }
  }
}

// 4. Rust crate sources, when Rust manifests change (--locked: never rewrite the lockfile under judgment).
function scanCrates(c: Ctx): void {
  const deny = need(c, 'cargo-deny');
  const conf = join(c.cfg, 'deny.toml');
  if (!existsSync(conf)) die(`no deny.toml in ${c.cfg}; failing closed`);
  const r = run(deny, ['--locked', '--log-level', 'error', '--config', conf, 'check', 'sources', 'bans'], { cwd: c.root });
  if (r.status === 0) return;
  const first = `${r.stdout}\n${r.stderr}`.split('\n').find(l => /error/i.test(l)) ?? '';
  addFinding(c, { id: 'cargo-deny:sources-bans', tool: 'cargo-deny', at: 'Cargo.lock', msg: first.slice(0, MSG_MAX) });
}

interface ZizmorFinding {
  ident: string;
  locations?: { symbolic?: { key?: { Local?: { verbatim_path?: string; given_path?: string } } }; concrete?: { location?: { start_point?: { row?: number } } } }[];
}

/** `<workflow file>:<1-based line>` of a zizmor finding's primary location. */
export function zizmorAt(z: ZizmorFinding): string {
  const loc = z.locations?.[0] ?? {};
  return `${zizmorPath(loc)}:${zizmorRow(loc) + 1}`;
}
type ZizmorLocation = NonNullable<ZizmorFinding['locations']>[number];
/** zizmor 1.30 names the file `verbatim_path` (older releases: `given_path`). */
function zizmorPath(loc: ZizmorLocation): string {
  const local = loc.symbolic?.key?.Local;
  return local?.verbatim_path ?? local?.given_path ?? '?';
}
function zizmorRow(loc: ZizmorLocation): number { return loc.concrete?.location?.start_point?.row ?? 0; }

// 5. GitHub Actions workflows.
function scanWorkflows(c: Ctx): void {
  const r = run(need(c, 'zizmor'), ['--offline', '--format', 'json', '--min-severity', 'medium', '.github/workflows'], { cwd: c.root });
  let out: unknown = null;
  try { out = JSON.parse(r.stdout); } catch { /* judged below */ }
  if (!Array.isArray(out)) die(`zizmor exited ${r.status} without a valid report: ${lastLine(r.stderr)}`);
  for (const z of out as ZizmorFinding[]) {
    const at = zizmorAt(z);
    addFinding(c, { id: `actions:${z.ident}@${at}`, tool: 'zizmor', at, msg: z.ident });
  }
}

// 6. New dependency names must be real, aged and adopted (hallucinated / typosquat guard).
function scanNewDeps(c: Ctx, locks: string[]): void {
  const guard = join(c.cfg, 'scripts/security-new-deps.ts');
  if (!existsSync(guard)) die(`no security-new-deps.ts in ${c.cfg}; failing closed`);
  const r = run(process.execPath, [guard, '--base', c.mb, '--', ...locks], { cwd: c.root });
  if (r.status !== EXIT_CLEAN && r.status !== EXIT_HELD) die(`new-dependency guard exited ${r.status}: ${lastLine(r.stderr)}`);
  const out = parseJson(r.stdout, 'new-dependency guard') as { checked?: unknown; held?: { ecosystem: string; name: string; reason: string }[] } | null;
  if (!Array.isArray(out?.checked)) die('new-dependency guard wrote no valid report');
  for (const h of out.held ?? []) {
    addFinding(c, { id: `newdep:${h.ecosystem}:${h.name}`, tool: 'new-deps', at: 'lockfile',
      msg: `${h.reason} — needs an owner decision`, hold: true });
  }
}

/**
 * 7. Project checks — the extension point. Each file in <config-dir>/security/checks/ (exported from origin/main
 * like the rest of the gate) runs with cwd = the repo, args `--base <merge-base> -- <changed paths...>` and
 * SECURITY_TOOLS_DIR set; `.ts` files run with node, anything else must be executable. It prints a JSON array of
 * {id, at, msg} on stdout and exits 0; any other exit or output fails the scan closed. Findings are recorded
 * as `check:<file>:<id>` and are acknowledged like any other finding.
 */
function runProjectChecks(c: Ctx): void {
  const dir = join(c.cfg, 'security/checks');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort().filter(n => isFile(join(dir, n)))) {
    const file = join(dir, name);
    const [cmd, args] = name.endsWith('.ts') ? [process.execPath, [file]] : [file, []];
    const r = run(cmd, [...args, '--base', c.mb, '--', ...c.changed], { cwd: c.root, env: { ...process.env, SECURITY_TOOLS_DIR: c.tools } });
    if (r.status !== 0) die(`project check ${name} exited ${r.status}: ${lastLine(r.stderr)}`);
    const out = parseJson(r.stdout, `project check ${name}`);
    if (!Array.isArray(out)) die(`project check ${name} wrote no JSON array`);
    for (const f of out as { id: string; at?: string; msg?: string }[]) {
      addFinding(c, { id: `check:${name}:${f.id}`, tool: name, at: f.at ?? '?', msg: f.msg ?? '' });
    }
  }
}

function scanAll(c: Ctx): void {
  checkGateChanges(c);
  scanSecrets(c);
  scanSast(c);
  const locks = c.changed.filter(p => LOCKFILE.test(p));
  if (locks.length) scanVulns(c, locks);
  if (c.changed.some(p => CARGO_MANIFEST.test(p))) scanCrates(c);
  if (c.changed.some(p => WORKFLOW.test(p))) scanWorkflows(c);
  if (locks.length) scanNewDeps(c, locks);
  runProjectChecks(c);
}

interface Args { base: string; report: string; cfg: string }
const USAGE = 'usage: security-scan.ts [--base <ref>] [--report <file>] [--config-dir <dir>]';
export function parseArgs(argv: string[]): Args {
  const a: Args = { base: 'origin/main', report: '', cfg: '' };
  const keys: Record<string, keyof Args> = { '--base': 'base', '--report': 'report', '--config-dir': 'cfg' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys[argv[i]];
    if (!key || argv[i + 1] === undefined) die(USAGE);
    a[key] = argv[i + 1];
  }
  return a;
}

/** The main checkout of this repo (a lane worktree shares its .tooling/). */
export function mainCheckout(cwd: string): string {
  return git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim().replace(/\/\.git$/, '');
}

function context(a: Args, work: string): Ctx {
  const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const common = mainCheckout(root);
  const mb = run('git', ['merge-base', a.base, 'HEAD'], { cwd: root });
  if (mb.status !== 0) die(`cannot find the merge base with ${a.base}`);
  // NUL-separated, so names with spaces, quotes or newlines are judged like any other.
  const changed = git(['-c', 'core.quotePath=false', 'diff', '-z', '--name-only', '--diff-filter=ACMR', mb.stdout.trim(), 'HEAD'], root)
    .split('\0').filter(Boolean);
  return {
    root, work, changed, findings: [], mb: mb.stdout.trim(),
    cfg: a.cfg ? resolve(a.cfg) : root,
    tools: process.env.SECURITY_TOOLS_DIR || join(common, '.tooling/security/bin'),
    rules: process.env.SECURITY_RULES_DIR || join(common, '.tooling/security/rules'),
  };
}

const VERDICT: Record<number, string> = {
  [EXIT_CLEAN]: 'PASS',
  [EXIT_FINDINGS]: "FAIL: fix each finding or acknowledge it on its own line: 'security-ack: <id> — <reason>'",
  [EXIT_HELD]: 'HOLD: new dependencies or gate changes need an owner decision (docs/security-review.md)',
};

function scan(a: Args, work: string): number {
  const c = context(a, work);
  console.log(`security-scan: ${c.changed.length} changed file(s) since ${c.mb.slice(0, 9)}; gate config from ${c.cfg}`);
  if (c.changed.length) scanAll(c);
  const status = statusOf(c.findings);
  if (a.report) writeFileSync(a.report, JSON.stringify({ status, findings: c.findings }, null, 2));
  console.log(`security-scan: ${VERDICT[status]}`);
  return status;
}

function main(): number {
  const work = mkdtempSync(join(tmpdir(), 'security-scan-'));
  try {
    return scan(parseArgs(process.argv.slice(2)), work);
  } catch (e) {
    console.error(`security-scan: ${e instanceof ScanError ? e.message : String(e)}`);
    return EXIT_ERROR;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = main();
