#!/usr/bin/env node
// security-gate.test.ts — end-to-end checks of the pre-merge security gate in a throwaway repo: a clean diff
// with a full review passes; a missing section, an uncovered file, a planted secret, an unacknowledged or
// near-miss acknowledged finding, a scan that cannot run, a branch-neutered gate, an unapproved held dependency,
// an unsigned gate change (edit, deletion or rename), suppression comments and an unparseable lockfile all
// refuse the merge; a branch's cargo configuration is never executed by the scan.
// Needs the pinned scanners (scripts/setup-security-tools.sh); without them every case SKIPS with a message,
// unless SECURITY_REQUIRE_TOOLS=1 (CI with tools) — then a missing tool FAILS. The gate itself always fails
// closed — that is case "missing scanners fail closed". Needs network (crates.io / npm / osv.dev).
// Usage: node scripts/security-gate.test.ts   (SECURITY_TOOLS_DIR / SECURITY_RULES_DIR override the tool paths)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GATE_FILES } from './security-gate.ts';
import { mainCheckout } from './security-scan.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMON = mainCheckout(SRC);
const TOOLS = process.env.SECURITY_TOOLS_DIR || join(COMMON, '.tooling/security/bin');
const RULES = process.env.SECURITY_RULES_DIR || join(COMMON, '.tooling/security/rules');
const ESLINT_STACK = process.env.SECURITY_ESLINT_DIR || join(COMMON, '.tooling/security/eslint');
const MISSING = existsSync(join(TOOLS, 'gitleaks')) && existsSync(join(ESLINT_STACK, 'node_modules')) ? ''
  : `security scanners not installed at ${TOOLS} / ${ESLINT_STACK} (run scripts/setup-security-tools.sh)`;
const REQUIRE = process.env.SECURITY_REQUIRE_TOOLS === '1';
const SKIP = MISSING && !REQUIRE ? `${MISSING}; skipping the gate end-to-end test` : false;
const HAVE_CARGO = spawnSync('cargo', ['--version']).status === 0;

const T = mkdtempSync(join(tmpdir(), 'security-gate-test-'));
const REPO = join(T, 'repo');

function sh(cmd: string, args: string[], cwd = REPO): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
const g = (...args: string[]) => sh('git', args);

/** Writes a file and commits it on the current branch. */
function commit(path: string, text: string, msg: string): void {
  mkdirSync(dirname(join(REPO, path)), { recursive: true });
  writeFileSync(join(REPO, path), text);
  g('add', '--', path);
  g('commit', '-qm', msg);
}

/** Runs the gate as documented: origin/main's launcher (a lone copy), which exports and runs origin/main's gate. */
function gate(body: string, env: NodeJS.ProcessEnv = {}): { ok: boolean; out: string } {
  const file = join(T, 'body.md');
  writeFileSync(file, body);
  const launcher = join(T, 'launcher', 'security-gate.ts');
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(launcher, g('show', 'origin/main:scripts/security-gate.ts'));
  const r = spawnSync(process.execPath, [launcher, file], { cwd: REPO, encoding: 'utf8',
    env: { ...process.env, SECURITY_TOOLS_DIR: TOOLS, SECURITY_RULES_DIR: RULES, SECURITY_ESLINT_DIR: ESLINT_STACK, ...env } });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

function pushMain(): void {
  g('push', '-q', 'origin', 'HEAD:main');
  g('fetch', '-q', 'origin');
}

/** The feature branch, reset to origin/main plus one reviewed change. */
function fresh(): void {
  g('checkout', '-q', 'feature');
  g('reset', '-q', '--hard', 'origin/main');
  commit('src.py', 'x = 1\n', 'feature');
}

function setup(): void {
  sh('git', ['init', '-q', '--bare', join(T, 'origin.git')], T);
  sh('git', ['clone', '-q', join(T, 'origin.git'), REPO], T);
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  for (const f of GATE_FILES.filter(p => existsSync(join(SRC, p)))) cpSync(join(SRC, f), join(REPO, f), { recursive: true });
  writeFileSync(join(REPO, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(REPO, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'NodeNext', noEmit: true,
    skipLibCheck: true }, include: ['*.ts'] }));
  writeFileSync(join(REPO, 'lib.ts'), LIB_LINE_1);
  writeFileSync(join(REPO, 'README.md'), 'base\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  pushMain();
  g('checkout', '-q', '-b', 'feature');
  commit('src.py', 'x = 1\n', 'feature');
}

const review = (...paths: string[]) => `## Security review\n${paths.map(p => `- \`${p}\` reviewed\n`).join('')}\n`;
const signedAck = (id: string) => `security-ack: ${id} — owner sign-off: "test fixture"\n`;
const token = () => randomBytes(64).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 36);
const GOOD = 'body\n\n## Security review\n- `src.py` — constant, no input.\n';
const LEAK_REVIEW = review('src.py', 'leak.txt');
const DEP = 'serde-jsonx-fast-helper-zz';
const NPM_LOCK = JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' },
  [`node_modules/${DEP}`]: { version: '0.1.0', resolved: `https://registry.npmjs.org/${DEP}/-/${DEP}-0.1.0.tgz` } } }, null, 2);
const DEP_BODY = `${review('src.py', 'package-lock.json')}security-ack: newdep:npm:${DEP} — reviewed\n`
  + signedAck('gate-input:package-lock.json');
const LIB_LINE_1 = 'export function a(s: string): unknown { return eval(s); }\n';
const PREAPPROVE = `${review('src.py', 'security/approved-deps.txt')}security-ack: gate-change:security/approved-deps.txt — `;

void test('security gate end-to-end', { skip: SKIP }, async t => {
  assert.ok(!MISSING, `SECURITY_REQUIRE_TOOLS=1 but ${MISSING}`);
  setup();
  t.after(() => rmSync(T, { recursive: true, force: true }));

  await t.test('clean diff with every file reviewed passes', () => {
    const r = gate(GOOD);
    assert.ok(r.ok, r.out);
  });
  await t.test("missing '## Security review' refuses", () => assert.ok(!gate('body without a review\n').ok));
  await t.test('a changed file absent from the section refuses', () => {
    assert.ok(!gate('## Security review\n- `other.py` reviewed\n\nsrc.py mentioned outside the section\n').ok);
  });

  let id = '';
  await t.test('a planted secret refuses without an ack', () => {
    commit('leak.txt', `github_token = "ghp_${token()}"\n`, 'leak');
    const r = gate(LEAK_REVIEW);
    assert.ok(!r.ok);
    id = /secret:\S+/.exec(r.out)?.[0] ?? '';
    assert.ok(id, `the planted secret produced no finding id:\n${r.out}`);
  });
  await t.test('an ack must start its own line', () => {
    assert.ok(!gate(`${LEAK_REVIEW}\nsee security-ack: ${id} — mentioned inline\n`).ok);
  });
  await t.test('a near-miss ack id refuses', () => assert.ok(!gate(`${LEAK_REVIEW}\nsecurity-ack: ${id}X — near miss\n`).ok));
  await t.test('an ack with a blank reason refuses', () => assert.ok(!gate(`${LEAK_REVIEW}\nsecurity-ack: ${id} —    \n`).ok));
  await t.test('an exact whole-line ack lets the reviewed finding through', () => {
    const r = gate(`${LEAK_REVIEW}\nsecurity-ack: ${id} — test fixture token, not real\n`);
    assert.ok(r.ok, r.out);
  });
  await t.test('missing scanners fail closed', () => assert.ok(!gate(GOOD, { SECURITY_TOOLS_DIR: join(T, 'no-tools') }).ok));

  await t.test("a branch's edited gate is ignored (origin/main's gate still finds the secret)", () => {
    commit('scripts/security-scan.ts', 'process.exit(0);\n', 'neuter scanner');
    commit('scripts/security-gate.ts', 'process.exit(0);\n', 'neuter launcher');
    const r = gate(`${review('src.py', 'leak.txt', 'scripts/security-scan.ts', 'scripts/security-gate.ts')}`
      + signedAck('gate-change:scripts/security-scan.ts') + signedAck('gate-change:scripts/security-gate.ts'));
    assert.ok(!r.ok);
    assert.match(r.out, /secret:\S+ is neither fixed nor acknowledged/);
  });

  await t.test('a held dependency without owner approval refuses', () => {
    fresh();
    commit('package-lock.json', NPM_LOCK, 'new dep');
    const r = gate(DEP_BODY);
    assert.ok(!r.ok);
    assert.match(r.out, new RegExp(`HOLD newdep:npm:${DEP}`));
  });
  await t.test('an owner-approved held dependency (approved on origin/main) merges', () => {
    g('checkout', '-q', 'main');
    g('reset', '-q', '--hard', 'origin/main');
    appendFileSync(join(REPO, 'security/approved-deps.txt'), `npm:${DEP} — owner test fixture approval\n`);
    g('commit', '-qam', 'approve');
    pushMain();
    g('checkout', '-q', 'feature');
    g('rebase', '-q', 'origin/main');
    const r = gate(DEP_BODY);
    assert.ok(r.ok, r.out);
  });

  await t.test('a gate/approval change without owner sign-off refuses', () => {
    fresh();
    appendFileSync(join(REPO, 'security/approved-deps.txt'), 'crates:another-fixture — sneaky pre-approval\n');
    g('commit', '-qam', 'preapprove');
    assert.ok(!gate(`${PREAPPROVE}looks fine\n`).ok);
    assert.ok(!gate(`${PREAPPROVE}owner sign-off: "unterminated\n`).ok, 'a sign-off without its closing quote counts');
  });
  await t.test('a gate/approval change with a quoted owner sign-off merges', () => {
    const r = gate(`${PREAPPROVE}owner sign-off: "approve another-fixture" (test)\n`);
    assert.ok(r.ok, r.out);
  });

  await t.test('deleting a gate file is held', () => {
    fresh();
    g('rm', '-q', 'deny.toml');
    g('commit', '-qm', 'drop deny.toml');
    const r = gate(`${review('src.py', 'deny.toml')}security-ack: gate-change:deny.toml — looks fine\n`);
    assert.ok(!r.ok);
    assert.match(r.out, /HOLD gate-change:deny\.toml/);
  });
  await t.test('renaming a gate file away is held', () => {
    fresh();
    g('mv', 'security/approved-deps.txt', 'security/approved.txt');
    g('commit', '-qm', 'rename approvals');
    const r = gate(review('src.py', 'security/approved-deps.txt', 'security/approved.txt'));
    assert.ok(!r.ok);
    assert.match(r.out, /HOLD gate-change:security\/approved-deps\.txt/);
  });

  await t.test("a branch's .cargo/config.toml rustc-wrapper and rust-toolchain are not executed", { skip: !HAVE_CARGO && 'cargo not installed' }, () => {
    fresh();
    const marker = join(T, 'WRAPPER_RAN');
    const wrapper = join(T, 'wrap.sh');
    writeFileSync(wrapper, `#!/bin/sh\ntouch '${marker}'\nexec "$@"\n`);
    chmodSync(wrapper, 0o755);
    commit('Cargo.toml', '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n', 'crate');
    commit('Cargo.lock', 'version = 4\n\n[[package]]\nname = "fixture"\nversion = "0.1.0"\n', 'lock');
    commit('src/lib.rs', '', 'lib');
    commit('.cargo/config.toml', `[build]\nrustc-wrapper = "${wrapper}"\n`, 'wrapper');
    commit('rust-toolchain.toml', '[toolchain]\nchannel = "no-such-toolchain-zz"\n', 'toolchain');
    const r = gate(review('src.py', 'Cargo.toml', 'Cargo.lock', 'src/lib.rs', '.cargo/config.toml', 'rust-toolchain.toml'));
    assert.ok(!existsSync(marker), 'the scan executed the branch rustc-wrapper');
    assert.ok(r.ok, r.out);
  });

  await t.test('gitleaks:allow and nosemgrep comments do not hide findings', () => {
    fresh();
    commit('leak2.txt', `github_token = "ghp_${token()}" # gitleaks:allow\n`, 'allowed leak');
    commit('app.py', 'import subprocess, sys\nsubprocess.call(sys.argv[1], shell=True)  # nosemgrep\n', 'nosem');
    const r = gate(review('src.py', 'leak2.txt', 'app.py'));
    assert.ok(!r.ok);
    assert.match(r.out, /FINDING secret:\S+/);
    assert.match(r.out, /FINDING sast:\S+@app\.py:2/);
  });

  await t.test('a change to a lockfile the dependency guard cannot parse is held', () => {
    fresh();
    commit('yarn.lock', '# yarn lockfile v1\n\nleft-pad@1.3.0:\n  version "1.3.0"\n', 'yarn');
    const body = `${review('src.py', 'yarn.lock')}security-ack: lockfile:yarn.lock — `;
    const r = gate(`${body}reviewed\n`);
    assert.ok(!r.ok);
    assert.match(r.out, /HOLD lockfile:yarn\.lock/);
    const signed = gate(`${body}owner sign-off: "yarn.lock reviewed" (test)\n`);
    assert.ok(signed.ok, signed.out);
  });
  await t.test('a committed node_modules shim is refused and never imported', () => {
    fresh();
    const marker = join(T, 'SHIM_RAN');
    commit('node_modules/eslint/package.json', '{ "name": "eslint", "main": "index.js" }\n', 'shim manifest');
    commit('node_modules/eslint/index.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, '');\n`, 'shim');
    commit('b.ts', 'export const b = 1;\n', 'ts change');
    const r = gate(review('src.py', 'node_modules/eslint/package.json', 'node_modules/eslint/index.js', 'b.ts'));
    assert.ok(!r.ok);
    assert.match(r.out, /commits files under node_modules/);
    assert.ok(!existsSync(marker), 'the committed shim ran');
  });

  await t.test('a committed node_modules symlink is refused', () => {
    fresh();
    symlinkSync(T, join(REPO, 'node_modules'));
    g('add', '--', 'node_modules');
    g('commit', '-qm', 'link node_modules');
    const r = gate(review('src.py', 'node_modules'));
    assert.ok(!r.ok);
    assert.match(r.out, /commits files under node_modules \(node_modules\)/);
  });

  await t.test('an uncommitted edit cannot hide a committed finding', () => {
    fresh();
    commit('app.py', 'import subprocess, sys\nsubprocess.call(sys.argv[1], shell=True)\n', 'shell');
    writeFileSync(join(REPO, 'app.py'), 'x = 2\n');   // working tree only
    const r = gate(review('src.py', 'app.py'));
    g('checkout', '--', 'app.py');
    assert.ok(!r.ok);
    assert.match(r.out, /FINDING sast:\S+@app\.py:2/);
  });

  await t.test('a tampered scanner binary fails the scan', () => {
    fresh();
    const bad = join(T, 'bad-tools');
    mkdirSync(bad, { recursive: true });
    for (const f of readdirSync(TOOLS).filter(n => n !== 'gitleaks')) symlinkSync(join(TOOLS, f), join(bad, f));
    writeFileSync(join(bad, 'gitleaks'), `#!/bin/sh\nexec ${JSON.stringify(join(TOOLS, 'gitleaks'))} "$@"\n`);
    chmodSync(join(bad, 'gitleaks'), 0o755);
    const r = gate(GOOD, { SECURITY_TOOLS_DIR: bad });
    assert.ok(!r.ok);
    assert.match(r.out, /gitleaks does not match its pinned sha256/);
  });

  await t.test('the ESLint pass reports a changed line with eval() and not an unchanged one', () => {
    fresh();
    commit('lib.ts', `${LIB_LINE_1}export function b(s: string): unknown { return eval(s); }\n`, 'second eval');
    const r = gate(review('src.py', 'lib.ts'));
    assert.ok(!r.ok);
    assert.match(r.out, /FINDING eslint:no-eval@lib\.ts:2/);
    assert.doesNotMatch(r.out, /eslint:[^ ]+@lib\.ts:1\b/);
  });
});
