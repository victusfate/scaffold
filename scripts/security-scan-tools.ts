/**
 * security-scan-tools.ts — the third-party scanners of scripts/security-scan.ts: gitleaks (secrets), Semgrep
 * (SAST), osv-scanner (known vulnerabilities) and zizmor (GitHub Actions). Every scanner is hash-verified, runs
 * with a minimal environment, judges committed content (git history, or a `git archive` export — never the
 * working tree), and has its in-repo suppression mechanisms disabled (`gitleaks:allow`, `.gitleaksignore`,
 * `nosemgrep`, `.semgrepignore`, zizmor config and ignore comments), so a branch cannot hide its own findings.
 * Part of the gate: exported from origin/main with the rest of GATE_FILES.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { packConfigs } from './security-rules.ts';
import { type Ctx, EXIT_CLEAN, EXIT_FINDINGS, MAX_BUFFER, MSG_MAX, addFinding, die, exportTree, git, headTree,
  isFile, lastLine, minimalEnv, need, neutraliseSemgrepIgnore, parseJson, run } from './security-scan-core.ts';

/** Built-in SAST targets: the languages the pinned Semgrep packs cover. A project ADDS to these (never removes) with
 *  security/sast-targets.txt — see parseSastTargets. */
const SAST_EXT = /\.(rs|ts|tsx|mts|cts|js|jsx|mjs|cjs|py|sh|go|rb|java|toml|ya?ml|json)$/;
/** Where a project lists its extra SAST targets (a gate file: read from the gate dir, i.e. origin/main). */
export const SAST_TARGETS_FILE = 'security/sast-targets.txt';
/** Target tokens: a leading `.` makes an extension (`.gd`; one segment, matched against the last suffix), otherwise an
 *  exact file basename (`Dockerfile`, `Dockerfile.dev`). Literal characters only — compared as strings, never regex. */
const SAST_EXT_TOKEN = /^\.[A-Za-z0-9][A-Za-z0-9_+-]*$/;   // one extension segment: `.gd`, `.c++` (not `.tar.gz`)
const SAST_NAME_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_+.-]*$/;
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

// The latest registry packs, diffed against the repo's accepted rule set (security-rules.ts: trust, but verify).
function semgrepConfigs(c: Ctx, semgrep: string): string[] {
  const configs = packConfigs(c, semgrep);
  const repoRules = join(c.cfg, '.semgrep');
  if (existsSync(repoRules)) configs.push('--config', repoRules);
  return configs;
}

interface SemgrepResult {
  check_id: string; path: string; start: { line: number }; end?: { line: number }; extra: { severity: string; message: string };
}
interface SemgrepOut {
  results: SemgrepResult[];
  errors?: unknown[];
}

/** A semgrep error's type, reduced to an id-safe token. */
export function errorType(type: unknown): string {
  const t = Array.isArray(type) ? (type as unknown[])[0] : type;
  const s = typeof t === 'string' ? t : JSON.stringify(t ?? null);
  return s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, ERR_TYPE_MAX);
}

const clean = (p: string) => p.replace(/^\.\//, '');

/** Runs semgrep in an exported tree on `targets` (repo-relative) and returns its parsed output. */
function semgrepIn(c: Ctx, tree: string, configs: string[], targets: string[]): SemgrepOut {
  neutraliseSemgrepIgnore(tree);
  const r = run(need(c, 'semgrep'), ['scan', '--metrics=off', '--disable-version-check', '--quiet', '--json', '--disable-nosem',
    '--max-target-bytes=0', ...configs, '--', ...targets.map(p => `./${p}`)],   // ./ : never an option
  { cwd: tree, env: minimalEnv(c, { SEMGREP_SEND_METRICS: 'off' }) });
  if (r.status !== EXIT_CLEAN && r.status !== EXIT_FINDINGS) die(`semgrep exited ${r.status}: ${lastLine(r.stderr)}`);
  const out = parseJson(r.stdout, 'semgrep') as SemgrepOut | null;
  if (!Array.isArray(out?.results)) die('semgrep wrote no valid results');
  if (out.errors !== undefined && !Array.isArray(out.errors)) die('semgrep wrote invalid errors');
  return out;
}

/** A finding's identity across commits: rule, file and the matched source text (not its line number). */
export function resultKey(tree: string, r: SemgrepResult): string {
  const lines = readFileSync(join(tree, clean(r.path)), 'utf8').split('\n').slice(r.start.line - 1, r.end?.line ?? r.start.line);
  return `${r.check_id}\0${clean(r.path)}\0${lines.join('\n').replace(/\s+/g, ' ').trim()}`;
}

interface Run { tree: string; out: SemgrepOut }

/** Results of `head` not already present (by resultKey, with multiplicity) in `base`: what this diff introduces. */
export function newResults(head: Run, base: Run | null): SemgrepResult[] {
  const seen = new Map<string, number>();
  for (const r of base?.out.results ?? []) {
    const k = resultKey(base?.tree ?? '', r);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return head.out.results.filter(r => {
    const k = resultKey(head.tree, r);
    const n = seen.get(k) ?? 0;
    if (n > 0) seen.set(k, n - 1);
    return n === 0;
  });
}

// Only known target-parser errors can inherit a coverage gap. Rule, config, resource and unknown errors block.
const PARSE_ERRORS = new Set(['PartialParsing', 'ParseError', 'LexicalError', 'OtherParseError',
  'Syntax error', 'Lexical error', 'Other syntax error']);
interface SemgrepError { type: string; path: string; key: string | null }
function semgrepErrors(run: Run, targets: string[]): SemgrepError[] {
  if (run.out.errors !== undefined && !Array.isArray(run.out.errors)) die('semgrep wrote invalid errors');
  return (run.out.errors ?? []).map(value => semgrepError(value, run.tree, targets));
}
interface RawSemgrepError { type?: unknown; path?: unknown; spans?: { file?: unknown }[] }
function errorPaths(value: unknown): { e: RawSemgrepError; paths: string[] } {
  if (!value || typeof value !== 'object') die('semgrep wrote an invalid error');
  const e = value as RawSemgrepError;
  if (e.path !== undefined && typeof e.path !== 'string') die('semgrep error has an invalid path');
  if (e.spans !== undefined && (!Array.isArray(e.spans) || e.spans.some(s => !s || typeof s.file !== 'string'))) {
    die('semgrep error has invalid spans');
  }
  const paths = [e.path, ...(e.spans ?? []).map(s => s.file)].filter((p): p is string => typeof p === 'string');
  return { e, paths };
}
function parserType(type: unknown): unknown {
  if (!Array.isArray(type)) return type;
  // PartialParsing is the only tagged parser variant; malformed payloads must not inherit a baseline.
  if (type.length !== 2 || type[0] !== 'PartialParsing' || !Array.isArray(type[1])) return null;
  return type[0];
}
/** Match Git paths using the host separator only; a backslash can be a literal filename character on POSIX. */
export function semgrepPath(tree: string, file: string, pathApi = { relative, resolve, sep }): string {
  return pathApi.relative(tree, pathApi.resolve(tree, file)).split(pathApi.sep).join('/');
}
function semgrepError(value: unknown, tree: string, targets: string[]): SemgrepError {
  const { e, paths } = errorPaths(value);
  const normalized = paths.map(p => semgrepPath(tree, p));
  const path = normalized[0] || '?';
  const rawType: unknown = parserType(e.type);
  const scoped = normalized.length > 0 && normalized.every(p => p === path) && targets.includes(path) && isFile(join(tree, path));
  return { type: errorType(e.type), path,
    key: scoped && typeof rawType === 'string' && PARSE_ERRORS.has(rawType) ? `${rawType}\0${path}` : null };
}

/** Baseline findings and file-scoped parser gaps separately; inherited gaps remain visible, never a clean scan claim. */
export function reportSemgrep(c: Pick<Ctx, 'findings' | 'coverage'>, head: Run, base: Run | null, targets: string[]): void {
  for (const r of newResults(head, base).filter(x => x.extra.severity !== 'INFO')) {
    const at = `${clean(r.path)}:${r.start.line}`;
    const msg = r.extra.message.replace(/\s+/g, ' ').slice(0, MSG_MAX);
    addFinding(c, { id: `sast:${r.check_id.split('.').pop()}@${at}`, tool: 'semgrep', at, msg: `[${r.extra.severity}] ${msg}` });
  }
  const baseErrors = base ? semgrepErrors(base, targets) : [];
  const known = new Set(baseErrors.map(e => e.key).filter(k => k !== null));
  const errors = semgrepErrors(head, targets);
  // A config/global failure in the baseline scan also makes its results untrustworthy.
  const baseFailures = baseErrors.filter(e => e.key === null);
  for (const e of [...errors, ...baseFailures]) {
    if (e.key !== null && known.has(e.key)) {
      (c.coverage ??= []).push({ tool: 'semgrep', at: e.path, type: e.type,
        msg: 'existing parser coverage gap at merge base' });
    } else {
      addFinding(c, { id: `sast-error:${e.type}@${e.path}`, tool: 'semgrep', at: e.path,
        msg: `semgrep could not fully scan this file (${e.type})` });
    }
  }
}

// 2. SAST on changed source files of the committed HEAD: findings this diff introduces. The baseline is the same
//    scan of those files at the merge base (also an export), matched by rule, file and matched text.
//    --disable-nosem: a `nosemgrep` comment cannot hide a finding; --max-target-bytes=0: no size skip; every
//    .semgrepignore is removed from the exports (an empty one at the root means "ignore nothing").
export function scanSast(c: Ctx): void {
  const configs = semgrepConfigs(c, need(c, 'semgrep'));
  const isTarget = sastTargets(c.cfg);
  c.headPaths = c.changed.filter(isTarget);
  if (!c.headPaths.length) return;
  const head = headTree(c);
  const targets = c.headPaths.filter(p => isFile(join(head, p)));
  if (!targets.length) return;
  const headOut = semgrepIn(c, head, configs, targets);
  const atBase = git(['ls-tree', '-r', '-z', '--name-only', c.mb, '--', ...targets], c.root).split('\0').filter(Boolean);
  const baseTree = atBase.length ? exportTree(c, c.mb, join(c.work, 'base-tree'), atBase) : '';
  const base = baseTree ? { tree: baseTree, out: semgrepIn(c, baseTree, configs, atBase) } : null;
  reportSemgrep(c, { tree: head, out: headOut }, base, targets);
}

/**
 * Parses security/sast-targets.txt: one target per line, `#` starts a comment, blank lines are ignored. `.ext` adds
 * an extension, a bare name adds an exact basename (for extensionless files such as `Dockerfile`). Throws on any
 * malformed line, so a bad list fails the scan closed instead of silently scanning less.
 */
export function parseSastTargets(text: string): { exts: Set<string>; names: Set<string> } {
  const exts = new Set<string>();
  const names = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    if (!(line.startsWith('.') ? SAST_EXT_TOKEN : SAST_NAME_TOKEN).test(line)) die(`${SAST_TARGETS_FILE}:${i + 1}: "${line.slice(0, MSG_MAX)}" is not an extension (.ext) or a file name`);
    if (line.startsWith('.')) exts.add(line.toLowerCase());
    else names.add(line);
  });
  return { exts, names };
}

/** The SAST target test for a repo-relative path: the built-in languages plus the project's additions, if any. */
export function sastTargets(cfgDir: string): (p: string) => boolean {
  const file = join(cfgDir, SAST_TARGETS_FILE);
  const extra = existsSync(file) ? parseSastTargets(readFileSync(file, 'utf8')) : { exts: new Set<string>(), names: new Set<string>() };
  return p => {
    if (SAST_EXT.test(p)) return true;
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (extra.names.has(base)) return true;
    const dot = base.lastIndexOf('.');
    return dot > 0 && extra.exts.has(base.slice(dot).toLowerCase());
  };
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

// 5. GitHub Actions workflows and composite actions, in the HEAD export. --no-config / --no-ignores: neither a
//    branch zizmor.yml nor `# zizmor: ignore` comments can suppress a finding.
export function scanWorkflows(c: Ctx): void {
  const head = headTree(c);
  const dirs = ['.github/workflows', '.github/actions'].filter(d => existsSync(join(head, d)));
  if (!dirs.length) return;
  const r = run(need(c, 'zizmor'), ['--offline', '--no-config', '--no-ignores', '--format', 'json', '--min-severity', 'medium',
    ...dirs], { cwd: head, env: minimalEnv(c) });
  let out: unknown = null;
  try { out = JSON.parse(r.stdout); } catch { /* judged below */ }
  if (!Array.isArray(out)) die(`zizmor exited ${r.status} without a valid report: ${lastLine(r.stderr)}`);
  for (const z of out as ZizmorFinding[]) {
    const at = zizmorAt(z);
    addFinding(c, { id: `actions:${z.ident}@${at}`, tool: 'zizmor', at, msg: z.ident });
  }
}
