#!/usr/bin/env node
// Tests for lib/dependency-watch/pins.ts + versions.ts — runtime pin parsing and classification.

import { parsePins } from './pins.ts';
import { classify, type Releases } from './versions.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
const show = (v: unknown): string => JSON.stringify(v);
const NOW = '2026-11-19';

const RUBY: Releases = { ruby: { versions: ['3.3.13', '3.3.14', '3.4.12', '3.4.13', '4.0.9', '4.0.10'], eol: {} } };

// Ruby2Shell: a pin one patch behind its line is a `behind` finding naming the line's latest patch.
{
  const pins = parsePins([{ path: '.ruby-version', content: '3.4.12\n' }]);
  const r = classify(pins, RUBY, NOW);
  const f = r.findings[0];
  assert('3.4.12 is behind 3.4.13', r.findings.length === 1 && f.kind === 'behind' && f.runtime === 'ruby'
    && f.pinned === '3.4.12' && f.latest === '3.4.13' && f.file === '.ruby-version' && f.line === 1, show(r));
}

// rbenv-style prefix is accepted.
{
  const pins = parsePins([{ path: '.ruby-version', content: 'ruby-4.0.9' }]);
  const r = classify(pins, RUBY, NOW);
  assert('ruby- prefix parsed', show(r.findings) === show([{ runtime: 'ruby', file: '.ruby-version', line: 1, pinned: '4.0.9', kind: 'behind', latest: '4.0.10' }]), show(r));
}

// A pin on its line's latest patch is clean.
{
  const pins = parsePins([{ path: '.ruby-version', content: '3.3.14\n' }]);
  const r = classify(pins, RUBY, NOW);
  assert('latest patch is clean', r.findings.length === 0 && r.unchecked.length === 0, show(r));
}

const ALL: Releases = {
  ...RUBY,
  node: { versions: ['24.11.0', '24.11.1', '26.12.0', '26.13.1'], eol: {} },
  python: { versions: ['3.13.8', '3.13.9', '3.14.0'], eol: {} },
  go: { versions: ['1.27.3', '1.27.4'], eol: {} },
};
const one = (path: string, content: string) => classify(parsePins([{ path, content }]), ALL, NOW);
const behind = (path: string, content: string) => one(path, content).findings.map(f => f.kind === 'behind' ? `${f.runtime}@${f.pinned}->${f.latest}:${f.line}` : f.kind);

// Node, Python and Go pin files; Node's release line is its major.
assert('.node-version', show(behind('.node-version', '26.12.0\n')) === show(['node@26.12.0->26.13.1:1']), show(behind('.node-version', '26.12.0\n')));
assert('.nvmrc v-prefix', show(behind('web/.nvmrc', 'v24.11.0')) === show(['node@24.11.0->24.11.1:1']));
assert('.python-version', show(behind('.python-version', '3.13.8')) === show(['python@3.13.8->3.13.9:1']));
assert('.tool-versions maps asdf names, keeps line numbers',
  show(behind('.tool-versions', '# tools\nnodejs 26.12.0\nruby 3.4.13\ngolang 1.27.3\nterraform 1.9.0\n'))
    === show(['node@26.12.0->26.13.1:2', 'go@1.27.3->1.27.4:4']),
  show(behind('.tool-versions', '# tools\nnodejs 26.12.0\nruby 3.4.13\ngolang 1.27.3\nterraform 1.9.0\n')));

// Dockerfile FROM lines for official runtime images.
{
  const dockerfile = [
    'ARG BASE=ruby:3.4',
    'FROM --platform=$BUILDPLATFORM docker.io/library/ruby:3.4.12-slim AS build',
    'FROM node:26.12.0-alpine3.22',
    'FROM python:3.13-slim',
    'FROM golang@sha256:abc123',
    'FROM ${BASE}',
    'FROM alpine:3.22',
    'from golang:1.27.3 as gobuild',
  ].join('\n');
  const r = classify(parsePins([{ path: 'deploy/Dockerfile.prod', content: dockerfile }]), ALL, NOW);
  assert('Dockerfile exact pins are findings',
    show(r.findings.map(f => `${f.runtime}@${f.pinned}:${f.line}`)) === show(['ruby@3.4.12:2', 'node@26.12.0:3', 'go@1.27.3:8']), show(r.findings));
  assert('floating tag is info', r.info.length === 1 && r.info[0].runtime === 'python' && r.info[0].line === 4, show(r.info));
  assert('digest and ARG images are unchecked', show(r.unchecked.map(u => u.line)) === show([5, 6]), show(r.unchecked));
}

// Pins the check cannot evaluate are reported, never dropped and never clean.
{
  const lts = one('.nvmrc', 'lts/*');
  assert('lts alias unchecked', lts.unchecked.length === 1 && lts.findings.length === 0, show(lts));
  const future = one('.ruby-version', '9.9.9');
  assert('version above every known release unchecked', future.unchecked.length === 1 && future.findings.length === 0, show(future));
  const noData = classify(parsePins([{ path: '.ruby-version', content: '3.4.12' }]), {}, NOW);
  assert('runtime with no release data unchecked', noData.unchecked.length === 1, show(noData));
}

// End of life: a pin (exact or floating) on a line whose EOL date has passed is an `eol` finding.
{
  const TODAY = '2026-11-19';
  const withEol: Releases = {
    ruby: { versions: ['3.2.10', '3.2.11', '3.4.13'], eol: { '3.2': '2026-03-31', '3.4': '2028-03-31' } },
    node: { versions: ['20.19.0'], eol: { '20': true } },
  };
  const eolOf = (path: string, content: string) =>
    classify(parsePins([{ path, content }]), withEol, TODAY).findings.map(f => f.kind === 'eol' ? `${f.runtime}@${f.pinned}:eol:${f.since}` : `${f.kind}`);
  assert('EOL line with date', show(eolOf('.ruby-version', '3.2.11')) === show(['ruby@3.2.11:eol:2026-03-31']), show(eolOf('.ruby-version', '3.2.11')));
  assert('behind and EOL are separate findings', show(eolOf('.ruby-version', '3.2.10')) === show(['behind', 'ruby@3.2.10:eol:2026-03-31']), show(eolOf('.ruby-version', '3.2.10')));
  assert('floating pin on EOL line', show(eolOf('Dockerfile', 'FROM ruby:3.2-slim')) === show(['ruby@3.2:eol:2026-03-31']), show(eolOf('Dockerfile', 'FROM ruby:3.2-slim')));
  assert('EOL without a date', show(eolOf('.nvmrc', '20.19.0')) === show(['node@20.19.0:eol:null']), show(eolOf('.nvmrc', '20.19.0')));
  assert('supported line is clean', eolOf('.ruby-version', '3.4.13').length === 0);
  assert('EOL date after today is clean', classify(parsePins([{ path: '.ruby-version', content: '3.2.11' }]), withEol, '2026-03-30').findings.length === 0);
}

// Files that are not pin files are ignored.
assert('unrelated file ignored', parsePins([{ path: 'README.md', content: 'FROM ruby:3.4.12' }]).length === 0);

console.error(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
