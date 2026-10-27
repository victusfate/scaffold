#!/usr/bin/env node
// security-gate.test.ts — end-to-end checks of the pre-merge security gate in a throwaway repo: a clean diff
// with a full review passes; a missing section, an uncovered file, a planted secret, an unacknowledged or
// near-miss acknowledged finding, a scan that cannot run, a branch-neutered scanner, an unapproved held
// dependency and an unsigned gate change all refuse the merge.
// Needs the pinned scanners (scripts/setup-security-tools.sh); without them every case SKIPS with a message
// (the gate itself still fails closed — that is case "missing scanners fail closed").
// Usage: node scripts/security-gate.test.ts   (SECURITY_TOOLS_DIR / SECURITY_RULES_DIR override the tool paths)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const SKIP = existsSync(join(TOOLS, 'gitleaks')) ? false
  : `security scanners not installed at ${TOOLS} (run scripts/setup-security-tools.sh); skipping the gate end-to-end test`;

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
    env: { ...process.env, SECURITY_TOOLS_DIR: TOOLS, SECURITY_RULES_DIR: RULES, ...env } });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

function pushMain(): void {
  g('push', '-q', 'origin', 'HEAD:main');
  g('fetch', '-q', 'origin');
}

function setup(): void {
  sh('git', ['init', '-q', '--bare', join(T, 'origin.git')], T);
  sh('git', ['clone', '-q', join(T, 'origin.git'), REPO], T);
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('config', 'commit.gpgsign', 'false');
  for (const f of GATE_FILES.filter(p => existsSync(join(SRC, p)))) cpSync(join(SRC, f), join(REPO, f), { recursive: true });
  writeFileSync(join(REPO, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(REPO, 'README.md'), 'base\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  pushMain();
  g('checkout', '-q', '-b', 'feature');
  commit('src.py', 'x = 1\n', 'feature');
}

const GOOD = 'body\n\n## Security review\n- `src.py` — constant, no input.\n';
const LEAK_REVIEW = '## Security review\n- `src.py` ok\n- `leak.txt` ok\n';
const DEP = 'serde-jsonx-fast-helper-zz';
const DEP_BODY = `## Security review\n- \`src.py\` ok\n- \`Cargo.lock\` ok\n\nsecurity-ack: newdep:crates:${DEP} — reviewed\n`
  + 'security-ack: cargo-deny:sources-bans — fixture lockfile has no Cargo.toml\n';
const PREAPPROVE = '## Security review\n- `src.py` ok\n- `security/approved-deps.txt` ok\n\n'
  + 'security-ack: gate-change:security/approved-deps.txt — ';

void test('security gate end-to-end', { skip: SKIP }, async t => {
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
    const token = randomBytes(64).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 36);
    commit('leak.txt', `github_token = "ghp_${token}"\n`, 'leak');
    const r = gate(LEAK_REVIEW);
    assert.ok(!r.ok);
    id = /secret:\S+/.exec(r.out)?.[0] ?? '';
    assert.ok(id, `the planted secret produced no finding id:\n${r.out}`);
  });
  await t.test('an ack must start its own line', () => {
    assert.ok(!gate(`${LEAK_REVIEW}\nsee security-ack: ${id} — mentioned inline\n`).ok);
  });
  await t.test('a near-miss ack id refuses', () => assert.ok(!gate(`${LEAK_REVIEW}\nsecurity-ack: ${id}X — near miss\n`).ok));
  await t.test('an exact whole-line ack lets the reviewed finding through', () => {
    const r = gate(`${LEAK_REVIEW}\nsecurity-ack: ${id} — test fixture token, not real\n`);
    assert.ok(r.ok, r.out);
  });
  await t.test('missing scanners fail closed', () => assert.ok(!gate(GOOD, { SECURITY_TOOLS_DIR: join(T, 'no-tools') }).ok));

  await t.test("a branch's edited gate is ignored (origin/main's gate still finds the secret)", () => {
    commit('scripts/security-scan.ts', 'process.exit(0);\n', 'neuter scanner');
    commit('scripts/security-gate.ts', 'process.exit(0);\n', 'neuter launcher');
    const ack = (p: string) => `security-ack: gate-change:${p} — owner sign-off: "test"\n`;
    const r = gate(`${LEAK_REVIEW}- \`scripts/security-scan.ts\` ok\n- \`scripts/security-gate.ts\` ok\n\n`
      + ack('scripts/security-scan.ts') + ack('scripts/security-gate.ts'));
    assert.ok(!r.ok);
    assert.match(r.out, /secret:\S+ is neither fixed nor acknowledged/);
    g('reset', '-q', '--hard', 'HEAD~3');   // drop the leak and the neutering
  });

  await t.test('a held dependency without owner approval refuses', () => {
    commit('Cargo.lock', `version = 4\n\n[[package]]\nname = "${DEP}"\nversion = "0.1.0"\n`
      + 'source = "registry+https://github.com/rust-lang/crates.io-index"\n', 'new dep');
    assert.ok(!gate(DEP_BODY).ok);
  });
  await t.test('an owner-approved held dependency (approved on origin/main) merges', () => {
    g('checkout', '-q', 'main');
    g('reset', '-q', '--hard', 'origin/main');
    appendFileSync(join(REPO, 'security/approved-deps.txt'), `crates:${DEP} — owner test fixture approval\n`);
    g('commit', '-qam', 'approve');
    pushMain();
    g('checkout', '-q', 'feature');
    g('rebase', '-q', 'origin/main');
    const r = gate(DEP_BODY);
    assert.ok(r.ok, r.out);
  });

  await t.test('a gate/approval change without owner sign-off refuses', () => {
    g('reset', '-q', '--hard', 'origin/main');
    commit('src.py', 'x = 1\n', 'feature2');
    appendFileSync(join(REPO, 'security/approved-deps.txt'), 'crates:another-fixture — sneaky pre-approval\n');
    g('commit', '-qam', 'preapprove');
    assert.ok(!gate(`${PREAPPROVE}looks fine\n`).ok);
  });
  await t.test('a gate/approval change with a quoted owner sign-off merges', () => {
    const r = gate(`${PREAPPROVE}owner sign-off: "approve another-fixture" (test)\n`);
    assert.ok(r.ok, r.out);
  });
});
