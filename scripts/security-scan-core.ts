/**
 * security-scan-core.ts — shared plumbing for scripts/security-scan.ts (docs/security-review.md): the scan
 * context, fail-closed errors, findings, hash-verified tools, tree exports, and running a scanner with a minimal
 * environment. Part of the gate: exported from origin/main with the rest of GATE_FILES (scripts/security-gate.ts).
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;
export const EXIT_HELD = 3;
// quality-ok: magic-number — named constant (exported): longest scanner message kept in a finding
export const MSG_MAX = 160;
// quality-ok: magic-number — named constant (exported): 1 GiB cap on captured scanner output
export const MAX_BUFFER = 1 << 30;
/** git's empty tree: as --attr-source it applies NO .gitattributes, so export-ignore/export-subst cannot hide files. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface Finding { id: string; tool: string; at: string; msg: string; hold: boolean }

/** A setup or scanner failure: the scan fails closed with exit 2. */
export class ScanError extends Error {}
export function die(msg: string): never { throw new ScanError(msg); }

export interface Ctx {
  root: string; cfg: string; tools: string; rules: string; eslintStack: string; mb: string; work: string;
  /** Paths added, copied, modified or renamed-to (what scanners read). */
  changed: string[];
  /** Every path the diff touches, deletions and both sides of renames included (what the gate holds). */
  touched: string[];
  findings: Finding[];
  /** Tools whose pinned hash was verified this scan. */
  verified: Set<string>;
  /** The committed HEAD tree, exported once (scanners never read the working tree). */
  headTree?: string;
}

/**
 * The only parent variables a scanner sees: PATH, locale, temp dir, proxy and CA settings. Never tokens or
 * credentials, and HOME is a throwaway dir, so no scanner reads the user's dotfiles or credential stores.
 */
const PASS_THROUGH = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy',
  'NO_PROXY', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  // Node's extra trust roots: a sandbox whose egress proxy re-signs TLS (cloud agent sessions) sets it, and npm
  // cannot reach the registry without it. Operator environment only, never repo content.
  'NODE_EXTRA_CA_CERTS'];

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

export function isFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}

export function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** `<sha256>  <name>` lines of a tracked checksum file. */
export function checksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of text.split('\n').map(x => x.trim()).filter(Boolean)) {
    const [hash, name] = l.split(/\s+/);
    if (hash && name) out.set(name.replace(/^\*?\.\//, ''), hash);
  }
  return out;
}

/** A deterministic hash of a directory tree: sorted relative paths, file contents and symlink targets. */
export function treeHash(dir: string, skip: (rel: string) => boolean = () => false): string {
  const h = createHash('sha256');
  const entries = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(rel => !skip(rel)).sort();
  for (const rel of entries) {
    const p = join(dir, rel);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) h.update(`L\0${rel}\0${readlinkSync(p)}\n`);
    else if (st.isFile()) h.update(`F\0${rel}\0${sha256File(p)}\n`);
  }
  return h.digest('hex');
}

/** The file whose hash pins `tool`: the resolved binary, or semgrep's native core inside its venv. */
function pinnedArtifact(binPath: string, tool: string): string {
  const real = realpathSync(binPath);
  if (tool !== 'semgrep') return real;
  const lib = join(dirname(dirname(real)), 'lib');
  const py = existsSync(lib) ? readdirSync(lib).find(d => d.startsWith('python')) : undefined;
  return py ? join(lib, py, 'site-packages/semgrep/bin/semgrep-core') : die(`cannot find semgrep-core for ${real}`);
}

function expectedHashes(c: Pick<Ctx, 'cfg'>): Map<string, string> {
  const file = join(c.cfg, 'scripts/security-tools.sha256');
  if (!isFile(file)) die(`no scripts/security-tools.sha256 in ${c.cfg}; failing closed`);
  return checksums(readFileSync(file, 'utf8'));
}

/** The path of a scanner, after checking its pinned sha256 (scripts/security-tools.sha256 from the gate dir). */
export function need(c: Pick<Ctx, 'tools' | 'cfg' | 'verified'>, tool: string): string {
  const p = join(c.tools, tool);
  try { accessSync(p, constants.X_OK); } catch { die(`missing tool ${p} (run scripts/setup-security-tools.sh); failing closed`); }
  if (c.verified.has(tool)) return p;
  const key = tool === 'semgrep' ? 'semgrep-core' : tool;
  const want = expectedHashes(c).get(key) ?? die(`no pinned sha256 for ${key} in scripts/security-tools.sha256; failing closed`);
  if (sha256File(pinnedArtifact(p, tool)) !== want) die(`${tool} does not match its pinned sha256 (tampered or a different build); failing closed`);
  c.verified.add(tool);
  return p;
}

/** The pinned ESLint stack's node_modules, after checking its tree hash and lockfile against the gate's. */
export function eslintStack(c: Pick<Ctx, 'eslintStack' | 'cfg' | 'verified'>): string {
  const modules = join(c.eslintStack, 'node_modules');
  if (!existsSync(modules)) die(`no ESLint stack at ${c.eslintStack} (run scripts/setup-security-tools.sh); failing closed`);
  if (c.verified.has('eslint-stack')) return c.eslintStack;
  const lock = join(c.cfg, 'scripts/security-eslint-stack/package-lock.json');
  if (!isFile(lock) || !isFile(join(c.eslintStack, 'package-lock.json'))
    || sha256File(lock) !== sha256File(join(c.eslintStack, 'package-lock.json'))) {
    die('the installed ESLint stack was not installed from the gate\'s lockfile (re-run scripts/setup-security-tools.sh)');
  }
  const want = expectedHashes(c).get('eslint-stack') ?? die('no pinned eslint-stack hash in scripts/security-tools.sha256');
  if (treeHash(modules, rel => rel === '.package-lock.json') !== want) die('the ESLint stack does not match its pinned tree hash; failing closed');
  c.verified.add('eslint-stack');
  return c.eslintStack;
}

/**
 * Exports `<ref>` (optionally only `paths`) into `dir` with `git archive`, applying no .gitattributes, so scanners
 * judge committed content: never an uncommitted edit, an untracked file, or a branch's export-ignore.
 */
export function exportTree(c: Pick<Ctx, 'root' | 'work'>, ref: string, dir: string, paths: string[] = []): string {
  mkdirSync(dir, { recursive: true });
  const tar = join(c.work, `${dir.split('/').pop()}.tar`);
  const r = spawnSync('git', [`--attr-source=${EMPTY_TREE}`, 'archive', '--format=tar', '-o', tar, ref,
    ...(paths.length ? ['--', ...paths] : [])], { cwd: c.root, encoding: 'utf8' });
  if (r.status !== 0) die(`cannot export ${ref}: ${lastLine(r.stderr)}`);
  if (spawnSync('tar', ['-xf', tar, '-C', dir]).status !== 0) die(`cannot unpack the ${ref} export`);
  rmSync(tar);
  return dir;
}

/** The committed HEAD tree, exported once per scan. */
export function headTree(c: Ctx): string {
  c.headTree ??= exportTree(c, 'HEAD', join(c.work, 'head-tree'));
  return c.headTree;
}

/** Writes an empty `.semgrepignore` at the export root after removing every nested one. */
export function neutraliseSemgrepIgnore(dir: string): void {
  for (const rel of readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(p => p.split('/').pop() === '.semgrepignore')) {
    rmSync(join(dir, rel), { force: true });
  }
  writeFileSync(join(dir, '.semgrepignore'), '');
}
