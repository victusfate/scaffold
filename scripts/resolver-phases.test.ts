#!/usr/bin/env node
// Tests for the manifest-completeness phase (scripts/resolver-phases.ts) and the
// shared path matcher it uses (tools/lib/safe-write.ts compileKeepMatcher).
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { phaseManifestCompleteness, type PhaseCtx } from './resolver-phases.ts';
import { compileKeepMatcher } from '../tools/lib/safe-write.ts';

// A directory entry matches with or without its trailing slash (issue #183 item 7).
{
  const m = compileKeepMatcher(['packages/', 'docs', '*.lock']);
  assert.ok(m('packages/a/package.json'), 'dir/ prefix matches files below it');
  assert.ok(m('docs/x.md'), 'dir prefix without a slash still matches');
  assert.ok(m('sub/yarn.lock'), '* glob spans /');
  assert.ok(!m('packagesX/a.json'), 'a prefix only matches whole path segments');
}

function run(tracked: string[], internal: string, manifest: string[]): { fails: string[]; warns: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'resolver-phases-'));
  const fails: string[] = [], warns: string[] = [];
  try {
    const INTERNAL = join(dir, 'scaffold-internal.txt'), MANIFEST = join(dir, 'scaffold-files.txt');
    writeFileSync(INTERNAL, internal);
    writeFileSync(MANIFEST, manifest.join('\n'));
    const ctx = {
      fail: (_phase: string, msg: string) => { fails.push(msg); },
      warn: (_phase: string, msg: string) => { warns.push(msg); },
      rel: (p: string) => (p === INTERNAL ? 'scaffold-internal.txt' : 'scaffold-files.txt'),
      MANIFEST, INTERNAL, manifestSet: new Set(manifest), trackedFiles: tracked,
    } as unknown as PhaseCtx;
    phaseManifestCompleteness([], ctx);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { fails, warns };
}

// `packages/` in the internal list holds back the whole tree.
{
  const r = run(['packages/a/index.ts', 'packages/b/index.ts', 'README.md'], 'packages/\n', ['README.md']);
  assert.deepEqual(r.fails, [], r.fails.join('\n'));
}

// Several unclassified files under one new top-level directory: one error naming
// the directory and the line that classifies it, not one error per file.
{
  const r = run(['packages/a/index.ts', 'packages/b/index.ts', 'packages/b/x.ts', 'README.md', 'loose.ts'], '', ['README.md']);
  const dirErr = r.fails.filter(f => f.includes('packages/'));
  assert.equal(dirErr.length, 1, r.fails.join('\n'));
  assert.match(dirErr[0], /3 tracked files under packages\//);
  assert.match(dirErr[0], /add `packages\/` to scaffold-internal\.txt/);
  assert.ok(r.fails.some(f => f.startsWith('loose.ts is tracked')), 'a lone root file keeps its own error');
}

console.log('resolver-phases.test: ok');
