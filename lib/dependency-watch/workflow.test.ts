#!/usr/bin/env node
// Structural tests for lib/dependency-watch/dependency-watch.yml, the scheduled workflow template.
// No YAML parser (templates ship with node: builtins only), so these assert on the text the
// behavior depends on. The workflow's issue handling is verified by running it (see prd.md).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBlock } from './test-repo.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const wf = readFileSync(join(HERE, 'dependency-watch.yml'), 'utf8');
const security = readFileSync(join(ROOT, '.github/workflows/security.yml'), 'utf8');

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
const pinOf = (text: string, name: string): string | undefined => new RegExp(`${name}: (\\S+)`).exec(text)?.[1];

assert('marker on first line', wf.startsWith('# scaffold-dependency-watch'));
assert('daily default schedule', /schedule:\n\s+- cron: '17 6 \* \* \*'/.test(wf));
assert('manual dispatch and push triggers', /workflow_dispatch:/.test(wf) && /\n {2}push:\n/.test(wf));
assert('push runs only on the default branch', wf.includes('github.ref_name == github.event.repository.default_branch'));
assert('no permissions by default; job gets read + issues', /^permissions: \{\}$/m.test(wf) && /contents: read/.test(wf) && /issues: write/.test(wf));
assert('runs never overlap', /concurrency:\n\s+group: dependency-watch/.test(wf));

const uses = [...wf.matchAll(/uses: (\S+)/g)].map(m => m[1]);
assert('every action pinned by commit sha', uses.length > 0 && uses.every(u => /@[0-9a-f]{40}$/.test(u)), uses.join(' '));
assert('checkout drops credentials', /persist-credentials: false/.test(wf));
assert('osv-scanner pin matches security.yml',
  pinOf(wf, 'OSV_VERSION') === pinOf(security, 'OSV_VERSION') && pinOf(wf, 'OSV_SHA256') === pinOf(security, 'OSV_SHA256'),
  `${pinOf(wf, 'OSV_VERSION')} ${pinOf(wf, 'OSV_SHA256')}`);
assert('osv-scanner binary checksum verified', /sha256sum -c/.test(wf));

const runBlocks = runBlock(wf);
assert('no expressions interpolated into shell (template injection)', runBlocks.length > 0 && !runBlocks.includes('${{'));
assert('runtime check and report run from the shipped copy',
  runBlocks.includes('.github/dependency-watch/runtime-check.ts') && runBlocks.includes('.github/dependency-watch/report.ts'));
assert('runtime-check error fails the job before touching the issue',
  /rc" -ge 2[\s\S]*exit 1[\s\S]*gh issue/.test(runBlocks));
assert('osv exit 128 means no packages; other non-zero, non-1 exits fail', /128\)/.test(runBlocks) && /\*\)[^\n]*exit 1/.test(runBlocks));
assert('one tracking issue: oldest open labeled issue is edited, else created',
  /gh issue list --label "\$LABEL" --state open/.test(runBlocks) && /gh issue edit/.test(runBlocks) && /gh issue create/.test(runBlocks));
assert('clean run closes the issue', /gh issue close/.test(runBlocks));
assert('findings do not fail the job (no daily failure mail)', !/status" = findings[^\n]*\n[^\n]*exit 1/.test(runBlocks));

console.error(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
