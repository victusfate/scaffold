#!/usr/bin/env node
/**
 * security-gate.ts — the pre-merge security gate (docs/security-review.md). Run it from the
 * branch being merged, after the PR body is written, before every merge — and run origin/main's copy of THIS
 * file, never the branch's (a branch could edit its own launcher to exit 0). The launcher imports nothing, so a
 * lone copy runs:
 *
 *   git fetch -q origin main && git show origin/main:scripts/security-gate.ts > "$tmp/security-gate.ts" \
 *     && node "$tmp/security-gate.ts" <pr-body-file>
 *
 * It fetches origin/main, exports the gate's files (GATE_FILES below) FROM origin/main into a
 * temp dir and runs that copy, so the branch under judgment cannot weaken its own gate; changes to the gate take
 * effect only after they merge. When origin/main has no gate yet, SECURITY_GATE_BOOTSTRAP=1 exports it from
 * HEAD instead (the gate's own first merge only: `SECURITY_GATE_BOOTSTRAP=1 node scripts/security-gate.ts <body>`);
 * otherwise the merge is refused.
 *
 * The exported copy runs as `security-gate.ts --gate-dir <dir> <pr-body-file>` and checks:
 *   1. machine half: scripts/security-scan.ts passes, or each finding has a whole-line
 *      `security-ack: <id> — <reason>` in the PR body; a `gate-change:` hold's ack line also quotes
 *      `owner sign-off: "<owner words>"`; a held `newdep:<eco>:<name>` is listed as `<eco>:<name> — <owner words>`
 *      in security/approved-deps.txt AS MERGED ON origin/main.
 *   2. human half: a `## Security review` section names every changed file as `path` (backticked, exact).
 * Exit 0 = may merge; 4 = refuse (every failure path fails closed). A refusal lists EVERY problem it found
 * (all uncovered files, all unacknowledged findings, all unsigned holds), so one fix round clears them.
 *
 * Fast feedback before the slow steps (neither replaces the gate above, which still runs unchanged at merge):
 *   --draft                print a `## Security review` skeleton naming every changed file (paste, then review).
 *   --precheck <pr-body>   the human half only, from this checkout: section present, every changed file named,
 *                          every `security-ack:` line well-formed. Seconds, no scanners — run it before preflight.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Finding } from './security-scan-core.ts';

/** The gate's own files and approvals (paths or directories), exported from origin/main by the launcher.
 *  security-scan.ts holds a change to any of them for the owner's sign-off (`gate-change:<path>`). */
export const GATE_FILES = ['scripts/security-gate.ts', 'scripts/security-scan.ts', 'scripts/security-scan-core.ts',
  'scripts/security-scan-tools.ts', 'scripts/security-scan-deps.ts', 'scripts/security-eslint.ts',
  'scripts/security-eslint-stack', 'scripts/security-new-deps.ts', 'scripts/security-rules.ts',
  'scripts/security-tools.sha256', 'scripts/setup-security-tools.sh', 'security/approved-deps.txt',
  'security/eslint-tuning.json', 'security/sast-targets.txt', '.gitleaks.toml', 'deny.toml', '.semgrep', 'security/checks'];
/** Gate STATE exported from origin/main beside GATE_FILES but verified by the scan rather than held for the owner:
 *  the accepted Semgrep rule set (security-rules.ts checks a change to it accepts exactly the packs served now). */
export const GATE_STATE_FILES = ['security/rules-accepted.json'];
export const EXIT_REFUSE = 4;
const SCAN_OK = [0, 1, 3];   // security-scan.ts: clean, findings, held — anything else is a scanner error
const SELF = 'scripts/security-gate.ts';
const MAX_BUFFER = 1 << 30;

class Refusal extends Error {}
/** Problems gathered in one pass; `settle` refuses once with all of them. */
let problems: string[] = [];
function note(msg: string): void { problems.push(msg); }
function settle(): void {
  if (!problems.length) return;
  const all = problems; problems = [];
  refuse(all.length === 1 ? all[0] : `${all.length} problems:\n  - ${all.join('\n  - ')}`);
}
function refuse(msg: string): never { throw new Refusal(msg); }

function git(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

/** Body lines, without a trailing CR (bodies edited on Windows still match). */
function lines(text: string): string[] {
  return text.split('\n').map(l => l.replace(/\r$/, ''));
}

/** Lines of `text` that start with `prefix` and continue with a non-blank reason. */
function reasoned(text: string, prefix: string): string[] {
  return lines(text).filter(l => l.startsWith(prefix) && l.slice(prefix.length).trim() !== '');
}

/** `security-ack: <id> — <reason>` as a whole line: an id merely quoted elsewhere does not count. */
export function ackLine(body: string, id: string): string | undefined {
  return reasoned(body, `security-ack: ${id} — `)[0];
}

/** True when some ack line for `id` quotes the owner: `owner sign-off: "<words>"` (closing quote required).
 *  This is text, not authentication: see docs/security-review.md "What the gate cannot prove". */
export function ownerSignedOff(body: string, id: string): boolean {
  return reasoned(body, `security-ack: ${id} — `).some(l => /owner sign-off: "[^"]*\S[^"]*"/.test(l));
}

/** True when approved-deps.txt has `<eco>:<name> — <owner words>` for this dependency. */
export function depApproved(approvals: string, dep: string): boolean {
  return reasoned(approvals, `${dep} — `).length > 0;
}

/** Holds released by the owner's quoted sign-off on the ack line (rather than by approved-deps.txt). */
const SIGN_OFF_HOLDS = ['gate-change:', 'gate-input:', 'lockfile:'];

/** The text of the `## Security review` section (up to the next `## ` heading). */
export function reviewSection(body: string): string {
  const all = lines(body);
  const start = all.findIndex(l => /^## Security review\s*$/.test(l));
  if (start < 0) return '';
  const rest = all.slice(start + 1);
  const end = rest.findIndex(l => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/** Changed files the section does not name as `path`. */
export function uncovered(section: string, changed: string[]): string[] {
  return changed.filter(f => !section.includes(`\`${f}\``));
}

/** old -> new paths of renames in `git diff -z --name-status -M` output (`R<score>\0old\0new\0`, `C` copies too). */
export function renamePairs(nameStatusZ: string): Map<string, string> {
  const t = nameStatusZ.split('\0');
  const pairs = new Map<string, string>();
  for (let i = 0; i < t.length; i++) {
    if (/^[RC]\d*$/.test(t[i]!) && t[i + 1] && t[i + 2]) { pairs.set(t[i + 1]!, t[i + 2]!); i += 2; }
    else if (/^[A-Z]\d*$/.test(t[i]!)) i += 1;
  }
  return pairs;
}

/** The refusal text for one uncovered path; a rename's two sides are both changed paths and both must be listed. */
export function uncoveredNote(f: string, renames: Map<string, string>): string {
  const to = renames.get(f);
  const from = [...renames].find(([, n]) => n === f)?.[0];
  const hint = to ? ` (renamed to \`${to}\` — list both paths)` : from ? ` (renamed from \`${from}\` — list both paths)` : '';
  return `the security review does not cover \`${f}\`${hint}`;
}

function judgeFinding(f: Finding, body: string, gateDir: string): void {
  if (!ackLine(body, f.id)) { note(`finding ${f.id} is neither fixed nor acknowledged ('security-ack: ${f.id} — <reason>' on its own line)`); return; }
  if (!f.hold) return;
  if (SIGN_OFF_HOLDS.some(h => f.id.startsWith(h))) {
    // Gate/approval files or an unvettable lockfile changed: the ack line itself must quote the owner's sign-off.
    if (!ownerSignedOff(body, f.id)) note(`${f.id} is held; its ack line needs 'owner sign-off: "<owner quote>"'`);
    return;
  }
  // A held new dependency merges only when the OWNER approved it in security/approved-deps.txt as merged on
  // origin/main (read from the exported gate dir): a branch cannot approve its own dependency.
  const dep = f.id.replace(/^newdep:/, '');
  const file = join(gateDir, 'security/approved-deps.txt');
  if (!existsSync(file) || !depApproved(readFileSync(file, 'utf8'), dep)) {
    note(`held dependency ${dep} is not owner-approved in security/approved-deps.txt on origin/main`);
  }
}

// 1. Machine half: third-party scanners over the merged diff, configured from origin/main.
function machineHalf(gateDir: string, body: string): number {
  const work = mkdtempSync(join(tmpdir(), 'security-gate-'));
  try {
    const report = join(work, 'report.json');
    const r = spawnSync(process.execPath, [join(gateDir, 'scripts/security-scan.ts'), '--base', 'origin/main',
      '--config-dir', gateDir, '--report', report], { stdio: 'inherit' });
    const scan = r.status ?? -1;
    if (!SCAN_OK.includes(scan)) refuse(`scanner could not run (exit ${scan})`);
    let rep: { status?: number; findings?: Finding[] } = {};
    try { rep = JSON.parse(readFileSync(report, 'utf8')) as typeof rep; } catch { /* judged below */ }
    if (rep.status !== scan || !Array.isArray(rep.findings)) refuse(`scan report is missing or inconsistent with exit ${scan}`);
    for (const f of rep.findings) judgeFinding(f, body, gateDir);
    return scan;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// 2. Human half: a `## Security review` section naming every changed file as `path` (backticked, exact).
function changedFiles(): string[] {
  const mb = git(['merge-base', 'origin/main', 'HEAD']);
  if (!mb.ok) refuse('no merge base with origin/main');
  const diff = git(['-c', 'core.quotePath=false', 'diff', '-z', '--name-only', '--no-renames', mb.out.trim(), 'HEAD']);
  if (!diff.ok) refuse('cannot list the changed files');
  return diff.out.split('\0').filter(Boolean);
}

function humanHalf(body: string): void {
  const section = reviewSection(body);
  if (!section.trim()) refuse("the PR body has no '## Security review' section");
  const mb = git(['merge-base', 'origin/main', 'HEAD']);
  const ns = git(['-c', 'core.quotePath=false', 'diff', '-z', '--name-status', '-M', mb.out.trim(), 'HEAD']);
  const renames = renamePairs(ns.ok ? ns.out : '');
  for (const f of uncovered(section, changedFiles())) note(uncoveredNote(f, renames));
}

/** `security-ack:` lines that the gate would not accept as an acknowledgement (no ` — <reason>`). */
export function malformedAcks(body: string): string[] {
  return lines(body).filter(l => l.startsWith('security-ack:') && !/^security-ack: \S+ — .*\S/.test(l));
}

/** --precheck: the human half from this checkout plus ack-line shape, all problems at once. No scanners. */
function precheck(bodyFile: string): void {
  const body = existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : '';
  if (!body) refuse(`PR body ${bodyFile} is missing or empty`);
  humanHalf(body);
  for (const l of malformedAcks(body)) note(`malformed ack line (needs 'security-ack: <id> — <reason>'): ${l}`);
  settle();
  console.log('security gate precheck: passed (review covers every changed file; ack lines well-formed). The full gate still runs at merge.');
}

/** --draft: a `## Security review` skeleton naming every changed file, for the reviewer to complete. */
function draft(): void {
  console.log(['## Security review', '- **Review:** <independent reviewer, rounds, verdict>', '', 'Files:',
    ...changedFiles().map(f => `- \`${f}\`: <reviewed line by line by …>`)].join('\n'));
}

function judge(gateDir: string, bodyFile: string): void {
  const body = existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : '';
  if (!body) refuse(`PR body ${bodyFile} is missing or empty`);
  humanHalf(body);
  let scan: number;
  try {
    scan = machineHalf(gateDir, body);
  } catch (e) {
    // A scanner failure still refuses; keep the review problems already found in the same message.
    if (e instanceof Refusal && problems.length) { note(e.message); settle(); }
    throw e;
  }
  settle();
  console.log(`security gate: passed (scan exit ${scan}, review covers every changed file)`);
}

/** Which ref the gate is exported from: origin/main, or HEAD for the one-time bootstrap. */
function gateRef(): string {
  if (git(['cat-file', '-e', `origin/main:${SELF}`]).ok) return 'origin/main';
  if (process.env.SECURITY_GATE_BOOTSTRAP !== '1') refuse('origin/main has no security gate; refusing to merge');
  console.log('security gate: bootstrapping from this branch (origin/main has none yet; first merge only)');
  return 'HEAD';
}

function exportGate(ref: string, dir: string): void {
  const listed = git(['ls-tree', '-r', '-z', '--name-only', ref, '--', ...GATE_FILES, ...GATE_STATE_FILES]);
  if (!listed.ok) refuse(`cannot list the gate files on ${ref}`);
  const tar = join(dir, 'gate.tar');
  if (!git(['archive', '--format=tar', '-o', tar, ref, '--', ...listed.out.split('\0').filter(Boolean)]).ok) {
    refuse(`cannot export the security gate from ${ref}`);
  }
  if (spawnSync('tar', ['-xf', tar, '-C', dir]).status !== 0) refuse(`cannot unpack the security gate from ${ref}`);
  rmSync(tar);
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');   // the exported .ts files are ES modules
}

function launch(bodyFile: string): number {
  if (!git(['fetch', '-q', 'origin', 'main']).ok) refuse('cannot fetch origin/main');
  const ref = gateRef();
  const dir = mkdtempSync(join(tmpdir(), 'security-gate-dir-'));
  try {
    exportGate(ref, dir);
    const r = spawnSync(process.execPath, [join(dir, SELF), '--gate-dir', dir, resolve(bodyFile)], { stdio: 'inherit' });
    return r.status === 0 ? 0 : EXIT_REFUSE;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv: string[]): number {
  try {
    if (argv[0] === '--gate-dir' && argv.length === 3) judge(argv[1], argv[2]);
    else if (argv[0] === '--precheck' && argv.length === 2) precheck(argv[1]);
    else if (argv[0] === '--draft' && argv.length === 1) draft();
    else if (argv.length === 1) return launch(argv[0]);
    else refuse('usage: node scripts/security-gate.ts <pr-body-file> | --precheck <pr-body-file> | --draft');
    return 0;
  } catch (e) {
    console.log(`security gate: ${e instanceof Refusal ? e.message : String(e)}`);
    return EXIT_REFUSE;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = main(process.argv.slice(2));
