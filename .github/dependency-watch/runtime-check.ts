#!/usr/bin/env node
// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/runtime-check.ts
// Runtime check: report tracked runtime pins that are behind their line's latest patch or on an
// end-of-life line. Run by the scheduled dependency-watch workflow; also runnable by hand.
//
//   node runtime-check.ts [--root <dir>] [--releases <fixture-dir>] [--today YYYY-MM-DD] [--fix]
//
// stdout: JSON { findings, info, unchecked[, patched] }. Exit 0 clean, 1 findings, 2 error.
// --fix bumps `behind` pins in place (see patch.ts); the exit then reflects what is left (EOL).
// Network: fetches only the release lists of runtimes the repo pins, unless --releases is given.
// An error is never reported as clean: missing or malformed release data exits 2.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isEntryPoint, todayIso } from './cli.ts';
import { applyPatches, planPatches, type Patch } from './patch.ts';
import { isPinFile, parsePins, type Pin, type Runtime } from './pins.ts';
import { ISO_DATE, RELEASE_URLS, eolUrl, parseEol, parseReleases } from './releases.ts';
import { classify, type Finding, type Releases } from './versions.ts';

const EXIT_FINDINGS = 1;
const EXIT_ERROR = 2;
const FETCH_TIMEOUT_MS = 30_000;
// Test data and vendored trees are not what the repo ships.
const NOT_SHIPPED = /(^|\/)(fixtures|testdata|vendor|node_modules)\//;
// Recorded payload names under --releases (ruby's index is tab-separated text, the rest JSON).
const RELEASE_FIXTURES: Record<Runtime, string> = { ruby: 'ruby.txt', node: 'node.json', python: 'python.json', go: 'go.json' };

interface Options { root: string; releasesDir?: string; today: string; fix: boolean; }

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: { root: { type: 'string' }, releases: { type: 'string' }, today: { type: 'string' }, fix: { type: 'boolean', default: false } },
  });
  const today = values.today ?? todayIso();
  if (!ISO_DATE.test(today)) throw new Error(`--today must be YYYY-MM-DD, got "${today}"`);
  return { root: values.root ?? '.', releasesDir: values.releases, today, fix: values.fix };
}

export const trackedFiles = (root: string): string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0').filter(path => path && !NOT_SHIPPED.test(path));

// The one pin loader: the scheduled check and setup's detect report the same pins.
export function trackedPins(root: string, tracked = trackedFiles(root)): Pin[] {
  return parsePins(tracked.filter(isPinFile).map(path => ({ path, content: readFileSync(join(root, path), 'utf8') })));
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

// Writes the bumps and returns those that took effect.
function writePatches(root: string, patches: Patch[]): Patch[] {
  return [...new Set(patches.map(p => p.file))].flatMap(file => {
    const path = join(root, file);
    const { content, applied } = applyPatches(readFileSync(path, 'utf8'), patches.filter(p => p.file === file));
    writeFileSync(path, content);
    return applied;
  });
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const pins = trackedPins(options.root);
  const runtimes = [...new Set(pins.flatMap(pin => pin.runtime ? [pin.runtime] : []))];
  const result = classify(pins, await loadReleases(runtimes, options), options.today);
  if (!options.fix) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.findings.length ? EXIT_FINDINGS : 0;
  }
  const patched = writePatches(options.root, planPatches(result.findings));
  const isPatched = (f: Finding): boolean => f.kind === 'behind' && patched.some(p => p.file === f.file && p.line === f.line);
  const findings = result.findings.filter(f => !isPatched(f));
  process.stdout.write(JSON.stringify({ ...result, findings, patched }, null, 2) + '\n');
  return findings.length ? EXIT_FINDINGS : 0;
}

if (isEntryPoint(import.meta.url)) {
  main().then(
    code => { process.exitCode = code; },
    (error: Error) => { console.error(`runtime-check: ${error.message}`); process.exitCode = EXIT_ERROR; },
  );
}
