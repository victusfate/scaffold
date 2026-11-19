#!/usr/bin/env node
// Tests for lib/dependency-watch/patch.ts — deterministic in-place bumps of `behind` runtime pins.

import { planPatches, applyPatches } from './patch.ts';
import type { Finding } from './versions.ts';
import { tally } from './test-helpers.ts';

const { assert, done } = tally();
const show = (v: unknown): string => JSON.stringify(v);
const behind = (file: string, line: number, pinned: string, latest: string): Finding =>
  ({ runtime: 'ruby', file, line, pinned, kind: 'behind', latest });

{
  const findings: Finding[] = [
    behind('.ruby-version', 1, '3.4.12', '3.4.13'),
    { runtime: 'node', file: 'Dockerfile', line: 3, pinned: '20', kind: 'eol', since: '2026-04-30' },
  ];
  const plan = planPatches(findings);
  assert('only behind findings are patched (EOL jumps need a decision)',
    show(plan) === show([{ file: '.ruby-version', line: 1, from: '3.4.12', to: '3.4.13' }]), show(plan));
}

const patchOne = (content: string, line: number, from: string, to: string): string =>
  applyPatches(content, [{ file: 'f', line, from, to }]).content;

assert('version file', patchOne('3.4.12\n', 1, '3.4.12', '3.4.13') === '3.4.13\n');
assert('prefix kept', patchOne('ruby-3.4.12', 1, '3.4.12', '3.4.13') === 'ruby-3.4.13');
assert('v prefix kept', patchOne('v24.11.0\n', 1, '24.11.0', '24.11.1') === 'v24.11.1\n');
assert('.tool-versions only the named line',
  patchOne('nodejs 26.12.0\nruby 3.4.12\n', 2, '3.4.12', '3.4.13') === 'nodejs 26.12.0\nruby 3.4.13\n');
assert('Dockerfile tag keeps its variant suffix and stage',
  patchOne('FROM base\nFROM docker.io/library/ruby:3.4.12-slim AS build\n', 2, '3.4.12', '3.4.13')
    === 'FROM base\nFROM docker.io/library/ruby:3.4.13-slim AS build\n');
assert('whole version token only (3.4.1 does not match inside 3.4.12)',
  patchOne('FROM ruby:3.4.12\n', 1, '3.4.1', '3.4.9') === 'FROM ruby:3.4.12\n');
assert('CRLF line endings kept', patchOne('3.4.12\r\n', 1, '3.4.12', '3.4.13') === '3.4.13\r\n');
{
  const once = patchOne('3.4.12\n', 1, '3.4.12', '3.4.13');
  assert('idempotent: re-applying to the patched file changes nothing', patchOne(once, 1, '3.4.12', '3.4.13') === once);
  const moved = applyPatches('# moved\n3.4.12\n', [{ file: 'f', line: 1, from: '3.4.12', to: '3.4.13' }]);
  assert('a pin no longer on its line is not reported as applied', moved.applied.length === 0 && moved.content === '# moved\n3.4.12\n');
}

done();
