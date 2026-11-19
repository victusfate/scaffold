#!/usr/bin/env node
// Tests for lib/dependency-watch/runtime-check.ts — the CLI the scheduled workflow runs.
// Offline: --releases points at recorded fixtures; --today pins the clock.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { repoWith, tally } from './test-helpers.ts';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Patch } from './patch.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'runtime-check.ts');
const FIXTURES = join(HERE, 'fixtures');
const TODAY = '2026-11-19';

const { assert, done } = tally();

function run(args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  let json: { findings?: { runtime: string; kind: string; file: string }[]; unchecked?: unknown[]; patched?: Patch[] } = {};
  try { json = JSON.parse(r.stdout) as typeof json; } catch { /* asserted below via status */ }
  return { status: r.status, json, stderr: r.stderr };
}

// Ruby2Shell day: tracked .ruby-version 3.4.12 and a Dockerfile node pin → findings, exit 1.
{
  const root = repoWith({ '.ruby-version': '3.4.12\n', 'app/Dockerfile': 'FROM node:26.12.0-slim\n' });
  const r = run(['--root', root, '--releases', FIXTURES, '--today', TODAY]);
  const kinds = (r.json.findings ?? []).map(f => `${f.runtime}:${f.kind}:${f.file}`).sort();
  assert('findings exit 1', r.status === 1, `status ${r.status} ${r.stderr}`);
  assert('reports ruby and node behind', JSON.stringify(kinds) === JSON.stringify(['node:behind:app/Dockerfile', 'ruby:behind:.ruby-version']), JSON.stringify(r.json));
}

// Current pins → clean, exit 0. Untracked files are not the repo's pins.
{
  const root = repoWith({ '.ruby-version': '3.4.13\n' }, { '.node-version': '24.0.0\n' });
  const r = run(['--root', root, '--releases', FIXTURES, '--today', TODAY]);
  assert('clean exit 0', r.status === 0 && r.json.findings?.length === 0, `status ${r.status} ${JSON.stringify(r.json)} ${r.stderr}`);
}

// Test data and vendored trees are not what the repo ships (same rule as setup's detect).
{
  const root = repoWith({ 'testdata/Dockerfile': 'FROM node:14.0.0\n', 'vendor/x/.ruby-version': '2.0.0\n' });
  const r = run(['--root', root, '--releases', FIXTURES, '--today', TODAY]);
  assert('fixture/vendor pins ignored', r.status === 0 && r.json.findings?.length === 0, `${r.status} ${JSON.stringify(r.json)}`);
}

// No pins → clean without needing any release data.
{
  const root = repoWith({ 'README.md': 'hi\n' });
  const r = run(['--root', root, '--releases', join(HERE, 'no-such-dir'), '--today', TODAY]);
  assert('no pins exit 0', r.status === 0, `status ${r.status} ${r.stderr}`);
}

// Missing release data is an error (exit 2), never "clean".
{
  const root = repoWith({ 'go.Dockerfile': 'FROM golang:1.27.3\n' });
  const empty = mkdtempSync(join(tmpdir(), 'no-releases-'));
  const r = run(['--root', root, '--releases', empty, '--today', TODAY]);
  assert('missing release data exit 2', r.status === 2 && /go/.test(r.stderr), `status ${r.status} ${r.stderr}`);
}

// Started through a symlink (Node resolves it for import.meta.url, not argv[1]) the check still runs.
{
  const root = repoWith({ '.ruby-version': '3.4.12\n' });
  const link = join(mkdtempSync(join(tmpdir(), 'link-')), 'runtime-check.ts');
  symlinkSync(CLI, link);
  const r = spawnSync(process.execPath, [link, '--root', root, '--releases', FIXTURES, '--today', TODAY], { encoding: 'utf8' });
  assert('runs when started through a symlink', r.status === 1 && r.stdout.includes('"behind"'), `${r.status} ${r.stderr}`);
}

// --fix bumps behind pins in place; EOL findings remain (they need a decision), so exit reflects them.
{
  const root = repoWith({
    '.ruby-version': '3.4.12\n',
    'Dockerfile': 'FROM ruby:3.4.12-slim AS build\nFROM node:24.11.0\n',
  });
  const r = run(['--root', root, '--releases', FIXTURES, '--today', TODAY, '--fix']);
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  assert('--fix patches version file and Dockerfile tag', read('.ruby-version') === '3.4.13\n'
    && read('Dockerfile').startsWith('FROM ruby:3.4.13-slim AS build\n'), `${read('.ruby-version')} ${read('Dockerfile')}`);
  assert('--fix reports what it patched', r.json.patched?.length === 3, JSON.stringify(r.json));
  const again = run(['--root', root, '--releases', FIXTURES, '--today', TODAY, '--fix']);
  assert('after --fix only decisions remain', (again.json.findings ?? []).every(f => f.kind === 'eol') && again.json.patched?.length === 0, JSON.stringify(again.json));
}

// Bad arguments are errors.
{
  assert('unknown flag exit 2', run(['--nope']).status === 2);
  assert('bad --today exit 2', run(['--today', 'tomorrow']).status === 2);
  const notGit = mkdtempSync(join(tmpdir(), 'not-git-'));
  assert('non-git root exit 2', run(['--root', notGit, '--releases', FIXTURES]).status === 2);
}

done();
