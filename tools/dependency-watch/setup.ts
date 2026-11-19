// dependency-watch setup: detect what a repo ships (ecosystems, runtime pins) and render the files
// /dependency-watch installs: the scheduled workflow, the runtime-check scripts, and a security-only
// dependabot.yml. Writes go through the clobber-safe contract (tools/lib/safe-write.ts).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadKeep, safeWrite, type WriteResult } from '../lib/safe-write.ts';
import { isPinFile, parsePins } from '../../lib/dependency-watch/pins.ts';

const MARKER = 'scaffold-dependency-watch';
const TEMPLATE_DIR = join('lib', 'dependency-watch');
const WORKFLOW = '.github/workflows/dependency-watch.yml';
const DEPENDABOT = '.github/dependabot.yml';
const SCRIPT_DIR = '.github/dependency-watch';
// The workflow's runtime check imports these; they ship together and import only node: builtins.
const SCRIPTS = ['pins.ts', 'releases.ts', 'versions.ts', 'runtime-check.ts', 'report.ts'];

export const DEFAULT_SCHEDULE = '17 6 * * *';
const CRON_LINE = /- cron: '([^']*)'/;
const CRON_FIELD = /^[0-9A-Za-z*/,-]+$/;
const CRON_FIELDS = 5;

// Lockfile / manifest basename → Dependabot package-ecosystem.
const ECOSYSTEM_FILES: Record<string, string> = {
  'Gemfile.lock': 'bundler',
  'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', 'yarn.lock': 'npm', 'pnpm-lock.yaml': 'npm', 'bun.lock': 'npm',
  'Cargo.lock': 'cargo', 'go.mod': 'gomod', 'composer.lock': 'composer',
  'Pipfile.lock': 'pip', 'poetry.lock': 'pip', 'uv.lock': 'uv',
};
const REQUIREMENTS = /^requirements.*\.txt$/;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
// Test data and vendored trees are not what the repo ships.
const NOT_SHIPPED = /(^|\/)(fixtures|testdata|vendor|node_modules)\//;

export type FileState = 'none' | 'foreign' | 'scaffold' | 'stale';
export interface Ecosystem { ecosystem: string; directories: string[]; }
export interface Detection {
  ecosystems: Ecosystem[];
  runtimePins: { file: string; line: number; runtime?: string; state: string }[];
  files: { path: string; state: FileState }[];
}
export interface Rendered { path: string; content: string; }

export function validateSchedule(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== CRON_FIELDS || !fields.every(f => CRON_FIELD.test(f))) {
    throw new Error(`--schedule must be a 5-field cron expression, got "${cron}"`);
  }
  return fields.join(' ');
}

function trackedFiles(repo: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function ecosystemOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (WORKFLOW_FILE.test(path)) return 'github-actions';
  return ECOSYSTEM_FILES[name] ?? (REQUIREMENTS.test(name) ? 'pip' : undefined);
}

function detectEcosystems(tracked: string[]): Ecosystem[] {
  const byEcosystem = new Map<string, Set<string>>();
  for (const path of tracked) {
    const ecosystem = ecosystemOf(path);
    if (!ecosystem || NOT_SHIPPED.test(path)) continue;
    // Actions are configured from the repo root, wherever the workflow files live.
    const dir = ecosystem === 'github-actions' || !path.includes('/') ? '/' : `/${dirname(path)}`;
    byEcosystem.set(ecosystem, (byEcosystem.get(ecosystem) ?? new Set()).add(dir));
  }
  return [...byEcosystem].sort(([a], [b]) => a.localeCompare(b))
    .map(([ecosystem, dirs]) => ({ ecosystem, directories: [...dirs].sort() }));
}

function renderDependabot(ecosystems: Ecosystem[]): string {
  const entries = ecosystems.flatMap(({ ecosystem, directories }) => [
    `  - package-ecosystem: ${ecosystem}`,
    `    directories: [${directories.map(d => `"${d}"`).join(', ')}]`,
    '    schedule:',
    '      interval: daily',
    '    open-pull-requests-limit: 0',
  ]);
  return [
    `# ${MARKER}`,
    '# Security updates only. open-pull-requests-limit: 0 turns off routine version-update PRs;',
    '# Dependabot security updates still use these entries once enabled in the repo settings',
    '# (Settings > Advanced Security > Dependabot security updates, or the /dependency-watch skill).',
    'version: 2',
    'updates:',
    ...entries,
    '',
  ].join('\n');
}

const readIfExists = (path: string): string | undefined => existsSync(path) ? readFileSync(path, 'utf8') : undefined;

// The cadence the repo already runs, so re-running setup never resets a customized schedule.
const currentSchedule = (repo: string): string | undefined => CRON_LINE.exec(readIfExists(join(repo, WORKFLOW)) ?? '')?.[1];

export function render(repo: string, srcRoot: string, schedule?: string): Rendered[] {
  const cron = schedule ?? currentSchedule(repo) ?? DEFAULT_SCHEDULE;
  const template = (name: string): string => readFileSync(join(srcRoot, TEMPLATE_DIR, name), 'utf8');
  const ecosystems = detectEcosystems(trackedFiles(repo));
  return [
    { path: WORKFLOW, content: template('dependency-watch.yml').replace(CRON_LINE, `- cron: '${cron}'`) },
    ...SCRIPTS.map(name => ({ path: `${SCRIPT_DIR}/${name}`, content: template(name) })),
    ...(ecosystems.length ? [{ path: DEPENDABOT, content: renderDependabot(ecosystems) }] : []),
  ];
}

function stateOf(repo: string, file: Rendered): FileState {
  const existing = readIfExists(join(repo, file.path));
  if (existing === undefined) return 'none';
  if (existing === file.content) return 'scaffold';
  return existing.includes(MARKER) ? 'stale' : 'foreign';
}

export function detect(repo: string, srcRoot: string): Detection {
  const tracked = trackedFiles(repo);
  const pinFiles = tracked.filter(path => isPinFile(path) && !NOT_SHIPPED.test(path));
  const pins = parsePins(pinFiles.map(path => ({ path, content: readFileSync(join(repo, path), 'utf8') })));
  return {
    ecosystems: detectEcosystems(tracked),
    runtimePins: pins.map(p => ({ file: p.file, line: p.line, runtime: p.runtime, state: p.state })),
    files: render(repo, srcRoot).map(file => ({ path: file.path, state: stateOf(repo, file) })),
  };
}

export interface EmitOptions { schedule?: string; force: boolean; }

export function emit(repo: string, srcRoot: string, options: EmitOptions): WriteResult[] {
  const results: WriteResult[] = [];
  const kept = loadKeep(repo);
  for (const file of render(repo, srcRoot, options.schedule)) {
    safeWrite(repo, file.path, file.content, kept, results, options.force);
  }
  return results;
}
