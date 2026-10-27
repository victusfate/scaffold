/**
 * security-scan-tools.ts — the third-party scanners of scripts/security-scan.ts: gitleaks (secrets), Semgrep
 * (SAST), osv-scanner (known vulnerabilities) and zizmor (GitHub Actions). Every scanner runs with a minimal
 * environment and with its in-repo suppression mechanisms disabled (`gitleaks:allow`, `.gitleaksignore`,
 * `nosemgrep`, zizmor config and ignore comments), so the branch under judgment cannot hide its own findings.
 * Part of the gate: exported from origin/main with the rest of GATE_FILES.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Ctx, EXIT_CLEAN, EXIT_FINDINGS, MAX_BUFFER, MSG_MAX, addFinding, die, isFile, lastLine, minimalEnv, need,
  parseJson, run } from './security-scan-core.ts';

const SAST_EXT = /\.(rs|ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|go|rb|java|toml|ya?ml|json)$/;
const ERR_TYPE_MAX = 40;

// 1. Secrets in the commits being merged (values redacted, never printed). The config always comes from the gate
//    dir (origin/main): a missing .gitleaks.toml fails the scan rather than letting gitleaks pick up the branch's.
export function scanSecrets(c: Ctx): void {
  const gitleaks = need(c, 'gitleaks');
  const conf = join(c.cfg, '.gitleaks.toml');
  if (!existsSync(conf)) die(`no .gitleaks.toml in ${c.cfg}; failing closed`);
  const report = join(c.work, 'gitleaks.json');
  const noIgnores = join(c.work, 'gitleaksignore');
  writeFileSync(noIgnores, '');   // an empty ignore file: the branch's .gitleaksignore is never read
  const args = ['git', '--redact', '--no-banner', '--config', conf, '--ignore-gitleaks-allow', '--gitleaks-ignore-path',
    noIgnores, '--exit-code', '0', `--log-opts=${c.mb}..HEAD`, '--report-format', 'json', '--report-path', report, '.'];
  const r = run(gitleaks, args, { cwd: c.root, env: minimalEnv(c) });
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

// 2. SAST on changed source files: findings this diff introduces (baseline = merge base). --disable-nosem: a
//    `nosemgrep` comment cannot hide a finding; --max-target-bytes=0: no file is skipped for its size.
export function scanSast(c: Ctx): void {
  const semgrep = need(c, 'semgrep');
  const configs = semgrepConfigs(c);
  const src = c.changed.filter(p => SAST_EXT.test(p) && isFile(join(c.root, p))).map(p => `./${p}`);   // ./ : never an option
  if (!src.length) return;
  const r = run(semgrep, ['scan', '--metrics=off', '--disable-version-check', '--quiet', '--json', '--disable-nosem',
    '--max-target-bytes=0', '--baseline-commit', c.mb, ...configs, '--', ...src],
  { cwd: c.root, env: minimalEnv(c, { SEMGREP_SEND_METRICS: 'off' }) });
  if (r.status !== EXIT_CLEAN && r.status !== EXIT_FINDINGS) die(`semgrep exited ${r.status}: ${lastLine(r.stderr)}`);
  const out = parseJson(r.stdout, 'semgrep') as SemgrepOut | null;
  if (!Array.isArray(out?.results)) die('semgrep wrote no valid results');
  reportSemgrep(c, out);
}

interface OsvOut { results: { packages?: { package: { name: string; version: string }; vulnerabilities?: { id: string }[] }[] }[] }

/** Vulnerable `name@version\tid` keys of one lockfile, or die. */
function osvIds(c: Ctx, lockCopy: string): Set<string> {
  const r = run(need(c, 'osv-scanner'), ['scan', 'source', '--lockfile', lockCopy, '--format', 'json'],
    { cwd: c.work, env: minimalEnv(c) });
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
  const copy = join(c.work, ref === 'HEAD' ? 'head' : 'base', lock);
  mkdirSync(dirname(copy), { recursive: true });
  writeFileSync(copy, r.stdout);
  return copy;
}

// 3. Known-vulnerable dependencies the diff introduces (lockfiles at HEAD vs the merge base).
export function scanVulns(c: Ctx, locks: string[]): void {
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

interface ZizmorFinding {
  ident: string;
  locations?: { symbolic?: { key?: { Local?: { verbatim_path?: string; given_path?: string } } }; concrete?: { location?: { start_point?: { row?: number } } } }[];
}
type ZizmorLocation = NonNullable<ZizmorFinding['locations']>[number];

/** `<workflow file>:<1-based line>` of a zizmor finding's primary location. */
export function zizmorAt(z: ZizmorFinding): string {
  const loc = z.locations?.[0] ?? {};
  return `${zizmorPath(loc)}:${zizmorRow(loc) + 1}`;
}
/** zizmor 1.30 names the file `verbatim_path` (older releases: `given_path`). */
function zizmorPath(loc: ZizmorLocation): string {
  const local = loc.symbolic?.key?.Local;
  return local?.verbatim_path ?? local?.given_path ?? '?';
}
function zizmorRow(loc: ZizmorLocation): number { return loc.concrete?.location?.start_point?.row ?? 0; }

// 5. GitHub Actions workflows. --no-config / --no-ignores: neither a branch zizmor.yml nor `# zizmor: ignore`
//    comments can suppress a finding.
export function scanWorkflows(c: Ctx): void {
  const r = run(need(c, 'zizmor'), ['--offline', '--no-config', '--no-ignores', '--format', 'json', '--min-severity', 'medium',
    '.github/workflows'], { cwd: c.root, env: minimalEnv(c) });
  let out: unknown = null;
  try { out = JSON.parse(r.stdout); } catch { /* judged below */ }
  if (!Array.isArray(out)) die(`zizmor exited ${r.status} without a valid report: ${lastLine(r.stderr)}`);
  for (const z of out as ZizmorFinding[]) {
    const at = zizmorAt(z);
    addFinding(c, { id: `actions:${z.ident}@${at}`, tool: 'zizmor', at, msg: z.ident });
  }
}
