#!/usr/bin/env node
/**
 * security-scan.ts — third-party security scanners over a merge diff: the machine half of the security
 * gate (docs/security-review.md). Runs inside scripts/security-gate.ts before every merge, and on demand.
 * Deterministic: the line-by-line review is the human half, checked by the gate.
 *
 *   node scripts/security-scan.ts [--base <ref>] [--report <file.json>] [--config-dir <dir>]
 *     --base        compare HEAD against this ref (default origin/main); only the diff is judged
 *     --report      write a JSON summary {status, findings:[{id,tool,at,msg,hold}]}
 *     --config-dir  where the gate's configs and helper scripts (GATE_FILES in security-gate.ts) come from. The
 *                   gate passes a copy exported from origin/main, so a branch can never weaken the gate that
 *                   judges it. Default: the repo being scanned.
 * Exit: 0 clean, 1 findings, 2 setup/scanner error (fails closed), 3 held (new dependency, gate change, or a
 * lockfile the dependency guard cannot parse).
 *
 * Tools (pinned installs from scripts/setup-security-tools.sh in $SECURITY_TOOLS_DIR, default
 * <main checkout>/.tooling/security/bin): gitleaks, semgrep, osv-scanner, cargo-deny, zizmor. Semgrep rule packs
 * come from $SECURITY_RULES_DIR (default <main checkout>/.tooling/security/rules) and must match the tracked
 * scripts/security-rules.sha256 on every scan. ESLint security rules (scripts/security-eslint.ts) run on changed
 * JS/TS files from the repo's own node_modules. Scanner modules: security-scan-{core,tools,deps}.ts.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GATE_FILES } from './security-gate.ts';
import { type Ctx, EXIT_CLEAN, EXIT_ERROR, EXIT_FINDINGS, EXIT_HELD, MSG_MAX, ScanError, addFinding, die, git, isFile,
  lastLine, minimalEnv, parseJson, run, statusOf } from './security-scan-core.ts';
import { scanSast, scanSecrets, scanVulns, scanWorkflows } from './security-scan-tools.ts';
import { GUARDED_LOCKFILE, OSV_LOCKFILE, holdUnparsedLockfiles, runProjectChecks, scanCrates,
  scanNewDeps } from './security-scan-deps.ts';

export { EXIT_CLEAN, EXIT_ERROR, EXIT_FINDINGS, EXIT_HELD };

const CARGO_MANIFEST = /(^|\/)Cargo\.(toml|lock)$/;
const WORKFLOW = /^\.github\/workflows\//;
const LINTED = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
/** In-repo suppression files: not read by the scan, but a change to one is held like a gate change. */
const SUPPRESSION_FILES = ['.semgrepignore', '.gitleaksignore'];

/** A path is a gate file when it is one, lies inside a gate directory, or is a scanner suppression file. */
export function isGatePath(p: string): boolean {
  if (GATE_FILES.some(g => p === g || p.startsWith(`${g}/`))) return true;
  return SUPPRESSION_FILES.some(f => p === f || p.endsWith(`/${f}`));
}

// 0. The gate's own files and the dependency approvals change only with the owner's sign-off (otherwise one PR
//    could loosen the gate or pre-approve a dependency for the next). Deletions and renames count: `touched`.
function checkGateChanges(c: Ctx): void {
  for (const p of c.touched.filter(isGatePath)) {
    addFinding(c, { id: `gate-change:${p}`, tool: 'gate', at: p,
      msg: "changes the security gate or its approvals — needs the owner's sign-off", hold: true });
  }
}

/** Line numbers HEAD added or changed in `file` relative to the merge base (from a zero-context diff). */
export function addedLines(diff: string): Set<number> {
  const lines = new Set<number>();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

// 7. ESLint security rules on changed JS/TS files — new findings only: a message counts when it is on a line this
//    diff added or changed (or the file could not be parsed at all).
function scanEslint(c: Ctx): void {
  const files = c.changed.filter(p => LINTED.test(p) && isFile(join(c.root, p)));
  if (!files.length) return;
  const runner = join(c.cfg, 'scripts/security-eslint.ts');
  if (!isFile(runner)) die(`no security-eslint.ts in ${c.cfg}; failing closed`);
  const r = run(process.execPath, [runner, '--tuning', join(c.cfg, 'security/eslint-tuning.json'), '--', ...files],
    { cwd: c.root, env: minimalEnv(c) });
  if (r.status !== 0) die(`security ESLint could not run (install the devDependencies: npm ci): ${lastLine(r.stderr)}`);
  const out = parseJson(r.stdout, 'security ESLint');
  if (!Array.isArray(out)) die('security ESLint wrote no JSON array');
  const added = new Map<string, Set<number>>();
  for (const m of out as { file: string; line: number; rule: string; msg: string }[]) {
    if (!added.has(m.file)) added.set(m.file, addedLines(git(['diff', '-U0', '--no-color', '--no-ext-diff', c.mb, 'HEAD', '--', m.file], c.root)));
    if (m.rule !== 'parse' && !added.get(m.file)?.has(m.line)) continue;
    const at = `${m.file}:${m.line}`;
    addFinding(c, { id: `eslint:${m.rule}@${at}`, tool: 'eslint', at, msg: m.msg.replace(/\s+/g, ' ').slice(0, MSG_MAX) });
  }
}

function scanAll(c: Ctx): void {
  checkGateChanges(c);
  scanSecrets(c);
  scanSast(c);
  const osvLocks = c.changed.filter(p => OSV_LOCKFILE.test(p));
  if (osvLocks.length) scanVulns(c, osvLocks);
  holdUnparsedLockfiles(c);
  if (c.changed.some(p => CARGO_MANIFEST.test(p))) scanCrates(c);
  if (c.changed.some(p => WORKFLOW.test(p))) scanWorkflows(c);
  const guarded = c.changed.filter(p => GUARDED_LOCKFILE.test(p));
  if (guarded.length) scanNewDeps(c, guarded);
  scanEslint(c);
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

/** NUL-separated paths of `git diff --name-only`, so names with spaces, quotes or newlines are judged like any other. */
function diffNames(root: string, mb: string, extra: string[]): string[] {
  return git(['-c', 'core.quotePath=false', 'diff', '-z', '--name-only', ...extra, mb, 'HEAD'], root).split('\0').filter(Boolean);
}

function context(a: Args, work: string): Ctx {
  const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const common = mainCheckout(root);
  const mbRun = run('git', ['merge-base', a.base, 'HEAD'], { cwd: root, env: process.env });
  if (mbRun.status !== 0) die(`cannot find the merge base with ${a.base}`);
  const mb = mbRun.stdout.trim();
  return {
    root, work, mb, findings: [],
    changed: diffNames(root, mb, ['--diff-filter=ACMR']),
    touched: diffNames(root, mb, ['--no-renames']),
    cfg: a.cfg ? resolve(a.cfg) : root,
    tools: process.env.SECURITY_TOOLS_DIR || join(common, '.tooling/security/bin'),
    rules: process.env.SECURITY_RULES_DIR || join(common, '.tooling/security/rules'),
  };
}

const VERDICT: Record<number, string> = {
  [EXIT_CLEAN]: 'PASS',
  [EXIT_FINDINGS]: "FAIL: fix each finding or acknowledge it on its own line: 'security-ack: <id> — <reason>'",
  [EXIT_HELD]: 'HOLD: new dependencies, gate changes or unparsed lockfiles need an owner decision (docs/security-review.md)',
};

function scan(a: Args, work: string): number {
  const c = context(a, work);
  console.log(`security-scan: ${c.touched.length} changed file(s) since ${c.mb.slice(0, 9)}; gate config from ${c.cfg}`);
  if (c.touched.length) scanAll(c);
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
