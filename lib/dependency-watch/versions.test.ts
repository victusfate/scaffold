#!/usr/bin/env node
// Tests for lib/dependency-watch/versions.ts — runtime pin parsing and classification.

import { parsePins, classify, type Releases } from './versions.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
const show = (v: unknown): string => JSON.stringify(v);

const RUBY: Releases = { ruby: { versions: ['3.3.13', '3.3.14', '3.4.12', '3.4.13', '4.0.9', '4.0.10'], eol: {} } };

// Ruby2Shell: a pin one patch behind its line is a `behind` finding naming the line's latest patch.
{
  const pins = parsePins([{ path: '.ruby-version', content: '3.4.12\n' }]);
  const r = classify(pins, RUBY);
  const f = r.findings[0];
  assert('3.4.12 is behind 3.4.13', r.findings.length === 1 && f.kind === 'behind' && f.runtime === 'ruby'
    && f.pinned === '3.4.12' && f.latest === '3.4.13' && f.file === '.ruby-version' && f.line === 1, show(r));
}

// rbenv-style prefix is accepted.
{
  const pins = parsePins([{ path: '.ruby-version', content: 'ruby-4.0.9' }]);
  const r = classify(pins, RUBY);
  assert('ruby- prefix parsed', r.findings[0]?.pinned === '4.0.9' && r.findings[0]?.latest === '4.0.10', show(r));
}

// A pin on its line's latest patch is clean.
{
  const pins = parsePins([{ path: '.ruby-version', content: '3.3.14\n' }]);
  const r = classify(pins, RUBY);
  assert('latest patch is clean', r.findings.length === 0 && r.unchecked.length === 0, show(r));
}

console.error(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
