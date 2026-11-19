#!/usr/bin/env node
// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/runtime-check.ts
// Runtime check: report tracked runtime pins that are behind their line's latest patch or on an
// end-of-life line. Run by the scheduled dependency-watch workflow; also runnable by hand.
//
//   node runtime-check.ts [--root <dir>] [--releases <fixture-dir>] [--today YYYY-MM-DD]
//
// stdout: JSON { findings, info, unchecked }. Exit 0 clean, 1 findings, 2 error.
// Network: fetches only the release lists of runtimes the repo pins, unless --releases is given.
// An error is never reported as clean: missing or malformed release data exits 2.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isPinFile, isShippedPath, parsePins, type Pin, type Runtime } from './pins.ts';
import { RELEASE_URLS, eolUrl, parseEol, parseReleases } from './releases.ts';
import { classify, type Releases } from './versions.ts';

const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;
const FETCH_TIMEOUT_MS = 30_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Recorded payload names under --releases (ruby's index is tab-separated text, the rest JSON).
const RELEASE_FIXTURES: Record<Runtime, string> = { ruby: 'ruby.txt', node: 'node.json', python: 'python.json', go: 'go.json' };

interface Options { root: string; releasesDir?: string; today: string; }

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: { root: { type: 'string' }, releases: { type: 'string' }, today: { type: 'string' } },
  });
  const today = values.today ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(today)) throw new Error(`--today must be YYYY-MM-DD, got "${today}"`);
  return { root: values.root ?? '.', releasesDir: values.releases, today };
}

export const trackedFiles = (root: string): string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0').filter(path => path && isShippedPath(path));

// The one pin loader: the scheduled check and setup's detect report the same pins.
export function trackedPins(root: string, tracked = trackedFiles(root)): Pin[] {
  return parsePinFiles(root, tracked.filter(isPinFile));
}

function parsePinFiles(root: string, tracked: string[]): Pin[] {
  return parsePins(tracked.map(path => ({ path, content: readFileSync(join(root, path), 'utf8') })));
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

function loadSource(options: Options): (runtime: Runtime, kind: 'releases' | 'eol') => Promise<string> {
  const { releasesDir } = options;
  if (releasesDir === undefined) {
    return (runtime, kind) => fetchText(kind === 'releases' ? RELEASE_URLS[runtime] : eolUrl(runtime));
  }
  return (runtime, kind) => {
    const name = kind === 'releases' ? RELEASE_FIXTURES[runtime] : `eol-${runtime}.json`;
    return Promise.resolve(readFileSync(join(releasesDir, name), 'utf8'));
  };
}

async function loadReleases(runtimes: Runtime[], options: Options): Promise<Releases> {
  const source = loadSource(options);
  const entries = await Promise.all(runtimes.map(async runtime => {
    try {
      const [versions, eol] = await Promise.all([source(runtime, 'releases'), source(runtime, 'eol')]);
      return [runtime, { versions: parseReleases(runtime, versions), eol: parseEol(eol) }] as const;
    } catch (error) {
      throw new Error(`${runtime} release data: ${(error as Error).message}`, { cause: error });
    }
  }));
  return Object.fromEntries(entries);
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const pins = trackedPins(options.root);
  const runtimes = [...new Set(pins.flatMap(pin => pin.runtime ? [pin.runtime] : []))];
  const result = classify(pins, await loadReleases(runtimes, options), options.today);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.findings.length ? EXIT_FINDINGS : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    code => { process.exitCode = code; },
    (error: Error) => { console.error(`runtime-check: ${error.message}`); process.exitCode = EXIT_ERROR; },
  );
}
