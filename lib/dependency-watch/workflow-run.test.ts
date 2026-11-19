#!/usr/bin/env node
// Runs the workflow template's shell step for real (bash, node, jq) against a temp repo, with `gh`,
// `curl` and osv-scanner stubbed, to verify the one-issue lifecycle before the workflow ever runs on
// GitHub (a scheduled/dispatch workflow only runs from the default branch).

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBlocks, tally } from './test-helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const wf = readFileSync(join(HERE, 'dependency-watch.yml'), 'utf8');
const [step] = runBlocks(wf);

const { assert, done } = tally();

const OSV_FINDINGS = readFileSync(join(HERE, 'fixtures', 'osv-gems.json'), 'utf8');

const STUB_GH = `#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
if [ "$1 $2" = "issue list" ]; then echo "$STUB_OPEN_ISSUES"; fi
`;
// curl "downloads" a fake osv-scanner that prints $STUB_OSV_JSON and exits $STUB_OSV_EXIT.
const STUB_CURL = `#!/usr/bin/env bash
while [ $# -gt 0 ]; do if [ "$1" = -o ]; then dest=$2; fi; shift; done
printf '#!/usr/bin/env bash\\ncat "$STUB_OSV_JSON"; exit "$STUB_OSV_EXIT"\\n' > "$dest"
`;
const STUB_SHA = '#!/usr/bin/env bash\ncat > /dev/null\n';

interface Scenario { git?: boolean; openIssues?: string; osvExit?: number; osvJson?: string; }

function runStep(s: Scenario) {
  const work = mkdtempSync(join(tmpdir(), 'dw-run-'));
  const repo = join(work, 'repo'), bin = join(work, 'bin'), temp = join(work, 'tmp');
  for (const d of [repo, bin, temp, join(repo, '.github/dependency-watch')]) mkdirSync(d, { recursive: true });
  for (const f of readdirSync(HERE).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    copyFileSync(join(HERE, f), join(repo, '.github/dependency-watch', f));
  }
  if (s.git !== false) execFileSync('git', ['init', '-q'], { cwd: repo });
  for (const [name, body] of [['gh', STUB_GH], ['curl', STUB_CURL], ['sha256sum', STUB_SHA]]) {
    writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755);
  }
  const osvJson = join(work, 'osv.json');
  writeFileSync(osvJson, s.osvJson ?? '{"results":[]}');
  const log = join(work, 'gh.log'), summary = join(work, 'summary.md');
  const r = spawnSync('bash', ['-c', step], {
    cwd: repo, encoding: 'utf8',
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: temp, GITHUB_WORKSPACE: repo,
      GITHUB_STEP_SUMMARY: summary, RUN_URL: 'https://example.test/run/1', LABEL: 'dependency-watch',
      OSV_VERSION: '0', OSV_SHA256: '0', STUB_LOG: log, STUB_OPEN_ISSUES: s.openIssues ?? '',
      STUB_OSV_JSON: osvJson, STUB_OSV_EXIT: String(s.osvExit ?? 0),
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  return { status: r.status, calls, out: r.stdout + r.stderr };
}
const issueCalls = (calls: string[]) => calls.filter(c => c.startsWith('gh issue ') && !c.startsWith('gh issue list'));

{
  const r = runStep({ osvExit: 1, osvJson: OSV_FINDINGS });
  const calls = issueCalls(r.calls);
  assert('findings, no open issue → create one; job succeeds', r.status === 0 && calls.length === 1 && calls[0].startsWith('gh issue create'), `${r.status} ${r.calls.join(' ; ')} ${r.out}`);
}
{
  const r = runStep({ osvExit: 1, osvJson: OSV_FINDINGS, openIssues: '5 7' });
  const calls = issueCalls(r.calls);
  assert('findings, open issues → edit the oldest only', r.status === 0 && calls.length === 1 && calls[0].startsWith('gh issue edit 5 '), `${r.calls.join(' ; ')} ${r.out}`);
  assert('extra open issue warned about', r.out.includes('more than one open dependency-watch issue: 7'), r.out);
}
{
  const r = runStep({ openIssues: '5' });
  const calls = issueCalls(r.calls);
  assert('clean, open issue → close it', r.status === 0 && calls.length === 1 && calls[0].startsWith('gh issue close 5'), `${r.calls.join(' ; ')} ${r.out}`);
}
{
  const r = runStep({});
  assert('clean, no issue → no issue calls', r.status === 0 && issueCalls(r.calls).length === 0, r.calls.join(' ; '));
}
{
  const r = runStep({ osvExit: 128 });
  assert('osv 128 (no lockfiles) is clean', r.status === 0 && issueCalls(r.calls).length === 0, `${r.status} ${r.out}`);
}
{
  const r = runStep({ git: false, openIssues: '5' });
  assert('runtime-check error → job fails, issue untouched', r.status === 1 && r.calls.length === 0, `${r.status} ${r.calls.join(' ; ')}`);
}
{
  const r = runStep({ osvExit: 3, openIssues: '5' });
  assert('osv-scanner error → job fails, issue untouched', r.status === 1 && issueCalls(r.calls).length === 0 && !r.calls.some(c => c.startsWith('gh issue list')), `${r.status} ${r.calls.join(' ; ')}`);
}

done();
