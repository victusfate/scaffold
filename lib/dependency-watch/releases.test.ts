#!/usr/bin/env node
// Tests for lib/dependency-watch/releases.ts — upstream release-list and EOL parsers.
// Fixtures are trimmed real payloads recorded 2026-11-19 (Ruby2Shell disclosure day).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReleases, parseEol, releaseNotesUrl } from './releases.ts';
import type { Runtime } from './pins.ts';
import { tally } from './test-helpers.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const { assert, done } = tally();
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const releases = (runtime: Runtime, file: string): string[] => parseReleases(runtime, fixture(file));

{
  const ruby = releases('ruby', 'ruby.txt');
  assert('ruby index lists the Ruby2Shell fixes', ['3.3.14', '3.4.13', '4.0.10'].every(v => ruby.includes(v)), ruby.join(' '));
  assert('ruby previews excluded', !ruby.some(v => v.includes('preview')) && ruby.every(v => /^\d+\.\d+\.\d+$/.test(v)));
}
{
  const node = releases('node', 'node.json');
  assert('node versions without v prefix', node.includes('26.13.1'), node.slice(0, 5).join(' '));
  assert('node pre-releases excluded', node.every(v => /^\d+\.\d+\.\d+$/.test(v)));
}
{
  const go = releases('go', 'go.json');
  assert('go versions without go prefix', go.includes('1.27.4') && go.includes('1.26.11'), go.slice(0, 5).join(' '));
  assert('go rc/beta excluded', go.every(v => /^\d+\.\d+\.\d+$/.test(v)));
}
{
  const python = releases('python', 'python.json');
  assert('python final releases', python.includes('3.13.9'), python.slice(0, 5).join(' '));
  assert('python pre-releases and install manager excluded', python.every(v => /^\d+\.\d+\.\d+$/.test(v)));
}
{
  const notes = { ruby: releaseNotesUrl('ruby', '3.4.13'), node: releaseNotesUrl('node', '26.13.1'),
    python: releaseNotesUrl('python', '3.13.9'), go: releaseNotesUrl('go', '1.27.4') };
  assert('release notes URLs', JSON.stringify(notes) === JSON.stringify({
    ruby: 'https://github.com/ruby/ruby/releases/tag/v3_4_13', node: 'https://github.com/nodejs/node/releases/tag/v26.13.1',
    python: 'https://www.python.org/downloads/release/python-3139/', go: 'https://go.dev/doc/devel/release#go1.27.4',
  }), JSON.stringify(notes));
}
{
  const eol = parseEol(fixture('eol-ruby.json'));
  assert('EOL date per line', eol['3.2'] === '2026-03-31' && eol['4.0'] === '2029-03-31', JSON.stringify(eol));
  assert('supported line without date is false', parseEol(fixture('eol-go.json'))['1.27'] === false);
}
{
  for (const bad of [null, '', 'soon', 2027, '2026-03-31\n## x']) {
    let threw = false;
    try { parseEol(JSON.stringify([{ cycle: '3.4', eol: bad }])); } catch { threw = true; }
    assert(`eol ${JSON.stringify(bad)} is malformed, not end-of-life`, threw);
  }
}
{
  let threw = false;
  try { parseReleases('node', '<html>maintenance</html>'); } catch { threw = true; }
  assert('malformed payload throws (never parsed as "no releases")', threw);
  threw = false;
  try { parseReleases('ruby', 'name\turl\n'); } catch { threw = true; }
  assert('empty release list throws', threw);
}

done();
