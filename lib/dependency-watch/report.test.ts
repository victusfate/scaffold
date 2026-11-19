#!/usr/bin/env node
// Tests for lib/dependency-watch/report.ts — the tracking-issue body built from runtime-check and
// osv-scanner JSON. Only structured fields may reach the body: advisory prose is untrusted.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, ISSUE_MARKER, type OsvOutput } from './report.ts';
import type { Classification } from './versions.ts';
import { tally } from './test-helpers.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const { assert, done } = tally();

const osv = JSON.parse(readFileSync(join(FIXTURES, 'osv-gems.json'), 'utf8')) as OsvOutput;
const CLEAN: Classification = { findings: [], info: [], unchecked: [] };
const RUNTIME: Classification = {
  findings: [
    { runtime: 'ruby', file: '.ruby-version', line: 1, pinned: '3.4.12', kind: 'behind', latest: '3.4.13' },
    { runtime: 'node', file: 'Dockerfile', line: 3, pinned: '20', kind: 'eol', since: '2026-04-30' },
  ],
  info: [],
  unchecked: [{ runtime: 'go', file: 'Dockerfile', line: 5, raw: 'FROM golang@sha256:abc', reason: 'pinned by digest' }],
};
const OPTS = { root: '/repo', runUrl: 'https://github.com/o/r/actions/runs/1', date: '2026-11-19' };

{
  const r = buildReport({ runtime: CLEAN, osv: { results: [] } }, OPTS);
  assert('nothing found is clean', r.status === 'clean', r.status);
}
{
  const r = buildReport({ runtime: RUNTIME, osv }, OPTS);
  assert('findings status', r.status === 'findings');
  assert('body starts with the issue marker', r.body.startsWith(ISSUE_MARKER));
  assert('runtime behind row', r.body.includes('| `.ruby-version:1` | ruby | 3.4.12 | behind: latest patch is [3.4.13](https://github.com/ruby/ruby/releases/tag/v3_4_13) |'), r.body);
  assert('runtime eol row', r.body.includes('| `Dockerfile:3` | node | 20 | end of life since 2026-04-30 ([schedule](https://endoflife.date/nodejs)) |'), r.body);
  assert('unchecked pin listed', r.body.includes('`Dockerfile:5`') && r.body.includes('pinned by digest'));
  assert('package row: relative path, ids linked, fixed versions',
    r.body.includes('| `Gemfile.lock` | `rack` | `2.2.3` | RubyGems |') && r.body.includes('[GHSA-22f2-v57c-j9cx](https://osv.dev/vulnerability/GHSA-22f2-v57c-j9cx)'), r.body);
  assert('fixed versions shown', /\| `rack` \|[^\n]*\| [0-9][^|]*\|$/m.test(r.body), r.body);
  assert('patch instruction names the agent command and the decision left',
    r.body.includes('`/dependency-watch fix`') && r.body.includes('1 end-of-life'), r.body);
  assert('run link and date', r.body.includes(OPTS.runUrl) && r.body.includes('2026-11-19'));
  assert('advisory prose never reaches the body',
    !/IGNORE PREVIOUS|attacker\.example|SYSTEM:|approve and merge/.test(r.body) && r.body.split(ISSUE_MARKER).length === 2, r.body);
}
{
  const a = buildReport({ runtime: RUNTIME, osv }, OPTS).body;
  const reversed: OsvOutput = { results: osv.results.map(res => ({ ...res, packages: [...res.packages].reverse() })) };
  const b = buildReport({ runtime: { ...RUNTIME, findings: [...RUNTIME.findings].reverse() }, osv: reversed }, OPTS).body;
  assert('deterministic order', a === b);
}
{
  // Hostile structured fields: ids and versions outside the safe charset are dropped, cells cannot break the table.
  const hostile: OsvOutput = { results: [{ source: { path: '/repo/package-lock.json' }, packages: [{
    package: { name: 'evil|pkg', version: '1.0.0', ecosystem: 'npm' },
    vulnerabilities: [{ id: 'GHSA-aaaa-bbbb-cccc](javascript:x)', affected: [] }, { id: 'GHSA-real-real-real', affected: [] }],
  }] }] };
  const body = buildReport({ runtime: CLEAN, osv: hostile }, OPTS).body;
  assert('unsafe id dropped, pipe escaped', !body.includes('javascript:') && body.includes('GHSA-real-real-real') && body.includes('`evil\\|pkg`'), body);
}
{
  // Scoped package names render as code, never as an @mention or a link.
  const scoped: OsvOutput = { results: [{ source: { path: '/repo/package-lock.json' }, packages: [{
    package: { name: '@babel/core [x](http://evil.example)', version: '7.0.0', ecosystem: 'npm' },
    vulnerabilities: [{ id: 'GHSA-aaaa-bbbb-cccc', affected: [] }],
  }] }] };
  const body = buildReport({ runtime: CLEAN, osv: scoped }, OPTS).body;
  assert('package name in a code span', body.includes('| `@babel/core [x](http://evil.example)` |'), body);
  const eol: Classification = { findings: [{ runtime: 'ruby', file: '.ruby-version', line: 1, pinned: '3.2.0', kind: 'eol', since: '2026-03-31\n\n## injected' }], info: [], unchecked: [] };
  const eolBody = buildReport({ runtime: eol, osv: { results: [] } }, OPTS).body;
  assert('eol date cannot break out of its row', !eolBody.includes('\n## injected'), eolBody);
}
{
  const many: OsvOutput = { results: [{ source: { path: '/repo/package-lock.json' }, packages: Array.from({ length: 250 }, (_, i) => ({
    package: { name: `pkg${String(i).padStart(3, '0')}`, version: '1.0.0', ecosystem: 'npm' },
    vulnerabilities: [{ id: `GHSA-x-${i}`, affected: [] }],
  })) }] };
  const body = buildReport({ runtime: CLEAN, osv: many }, OPTS).body;
  const rows = body.split('\n').filter(l => l.startsWith('| `package-lock.json`')).length;
  assert('package rows capped at 200 with a remainder line', rows === 200 && body.includes('50 more packages'), `rows ${rows}`);
}

done();
