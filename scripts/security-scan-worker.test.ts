/** Real dispatcher in a private repository; only expensive scanner implementations are fixtures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GATE_FILES } from './security-gate.ts';
import type { CoverageGap, Finding } from './security-scan-core.ts';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
type Failure = 'none' | 'throw' | 'all-errors' | 'exit-zero' | 'partial-zero' | 'partial' | 'timeout' | 'oom' | 'missing';
interface Timing { name: string; start: number; end: number }
interface Report { status: number; findings: Finding[]; coverage: CoverageGap[]; stages: { name: string }[] }

function fixture(mode: Failure = 'none') {
  const root = mkdtempSync(join(tmpdir(), 'scan-worker-test-'));
  try {
    for (const path of GATE_FILES.filter(p => existsSync(join(SRC, p)))) {
      cpSync(join(SRC, path), join(root, path), { recursive: true });
    }
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    if (mode !== 'missing') writeFileSync(join(root, 'scripts/security-scan-tools.ts'), `
import { addFinding, headTree, run, die } from './security-scan-core.ts';
import { existsSync, appendFileSync, readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
function scan(c, name) {
  const start = Date.now();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  if (name === 'semgrep') {
    const tree = headTree(c);
    if (!readFileSync(tree + '/README.md', 'utf8').includes('changed')) throw new Error('wrong committed content');
    if (existsSync(tree + '/untouched.txt')) throw new Error('unexpected full export');
  }
  if (name === 'semgrep') c.coverage = [{ tool: 'semgrep', at: 'README.md', type: 'PartialParsing', msg: 'baseline fixture' }];
  addFinding(c, { id: name + ':fixture', tool: name, at: 'README.md', msg: 'fixture only' });
  appendFileSync(c.root + '/timings', JSON.stringify({ name, start, end: Date.now() }) + '\\n');
  if (${JSON.stringify(mode)} === 'all-errors') throw new Error(name + ': injected failure');
  if (name !== 'gitleaks') return;
  if (${JSON.stringify(mode)} === 'throw') throw new Error('injected scanner crash');
  if (${JSON.stringify(mode)} === 'exit-zero') process.exit(0);
  if (${JSON.stringify(mode)} === 'partial-zero') {
    parentPort.postMessage({ name: 'gitleaks', findings: [] });
    process.exit(0);
  }
  if (${JSON.stringify(mode)} === 'partial') {
    parentPort.postMessage({ name: 'gitleaks', findings: [], started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(), seconds: 0, coverage: [] });
    process.exit(9);
  }
  if (${JSON.stringify(mode)} === 'timeout') {
    const r = run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'],
      { cwd: c.work, env: {}, timeout: 25 });
    if (r.status !== 0) die('scanner timed out: ' + r.error?.code);
  }
  if (${JSON.stringify(mode)} === 'oom') {
    const retained = [];
    while (true) retained.push(new Array(100000).fill('heap fixture'));
  }
}
export const scanSecrets = c => scan(c, 'gitleaks');
export const scanSast = c => scan(c, 'semgrep');
export const scanVulns = () => {};
export const scanWorkflows = () => {};
`);
    if (mode === 'oom') {
      const path = join(root, 'scripts/security-scan.ts');
      writeFileSync(path, readFileSync(path, 'utf8').replace('workerData: { securityScanStage:',
        'resourceLimits: { maxOldGenerationSizeMb: 24 }, workerData: { securityScanStage:'));
    }
    mkdirSync(join(root, 'security/checks'), { recursive: true });
    writeFileSync(join(root, 'security/checks/fixture.ts'), `
import { writeFileSync } from 'node:fs';
writeFileSync('project-ran', 'completed');
console.log(JSON.stringify([{ id: 'fixture', at: 'README.md', msg: 'fixture only' }]));
`);
    const git = (...args: string[]) => {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    };
    git('init', '-q'); git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'fixture'); git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(root, 'README.md'), 'base\n');
    writeFileSync(join(root, 'untouched.txt'), 'unrelated\n');
    git('add', '.'); git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(root, 'README.md'), 'changed\n');
    git('add', 'README.md'); git('commit', '-qm', 'change');
    writeFileSync(join(root, 'README.md'), 'uncommitted content\n');
    const r = spawnSync(process.execPath, [join(root, 'scripts/security-scan.ts'), '--report', join(root, 'report.json')], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, SECURITY_TOOLS_DIR: join(root, 'missing-tools'),
        SECURITY_ESLINT_DIR: join(root, 'missing-eslint'), SECURITY_RULES_DIR: join(root, 'missing-rules') },
    });
    assert.equal(r.error, undefined, String(r.error));
    const timings = existsSync(join(root, 'timings'))
      ? readFileSync(join(root, 'timings'), 'utf8').trim().split('\n').map(s => JSON.parse(s) as Timing) : [];
    const report = existsSync(join(root, 'report.json'))
      ? JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')) as Report : null;
    return { exit: r.status, report, timings, projectRan: existsSync(join(root, 'project-ran')), output: r.stdout, error: r.stderr };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

void test('dispatcher preserves findings and committed targets with overlapping workers', () => {
  const r = fixture();
  assert.equal(r.exit, 1, r.error);
  assert.ok(r.report);
  assert.deepEqual(r.report.findings.map(f => f.id).sort(), ['check:fixture.ts:fixture', 'gitleaks:fixture', 'semgrep:fixture']);
  assert.deepEqual(r.report.coverage, [{ tool: 'semgrep', at: 'README.md', type: 'PartialParsing', msg: 'baseline fixture' }]);
  assert.deepEqual(r.report.stages.map(s => s.name),
    ['gitleaks', 'semgrep', 'osv', 'zizmor', 'new-deps', 'eslint', 'project-checks', 'cargo-deny']);
  assert.match(r.output, /^security-stage: /m);
  const [a, b] = r.timings.sort((a, b) => a.start - b.start);
  assert.ok(b.start < a.end, 'independent scanners did not overlap');
});

for (const mode of ['throw', 'all-errors', 'exit-zero', 'partial-zero', 'partial', 'timeout', 'oom', 'missing'] as const) {
  void test(`dispatcher fails closed on ${mode} and drains independent workers`, () => {
    const r = fixture(mode);
    assert.equal(r.exit, 2, r.error);
    assert.equal(r.report, null, 'failed scan must not write an accepted report');
    assert.equal(r.projectRan, true, 'later queued project check must still run after failures');
    if (mode === 'missing') { assert.match(r.error, /missing tool/); return; }
    assert.equal(r.timings.length, 2, 'both scanners drained before cleanup');
    assert.match(r.error, /scanner stage gitleaks/);
    if (mode === 'all-errors') {
      assert.match(r.error, /gitleaks: injected failure/);
      assert.match(r.error, /semgrep: injected failure/);
    }
    if (mode === 'partial') assert.match(r.error, /exit 9/);
    if (mode === 'timeout') assert.match(r.error, /ETIMEDOUT/);
    if (mode === 'oom') assert.match(r.error, /memory|heap/i);
  });
}
