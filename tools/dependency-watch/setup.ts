// dependency-watch setup: detect what a repo ships (ecosystems, runtime pins) and render the files
// /dependency-watch installs: the scheduled workflow, the runtime-check scripts, and a security-only
// dependabot.yml. Writes go through the clobber-safe contract (tools/lib/safe-write.ts).

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { loadKeep, safeWrite, type WriteResult } from '../lib/safe-write.ts';
import type { Pin } from '../../lib/dependency-watch/pins.ts';
import { trackedFiles, trackedPins } from '../../lib/dependency-watch/runtime-check.ts';

const MARKER = 'scaffold-dependency-watch';
const TEMPLATE_DIR = join('lib', 'dependency-watch');
const WORKFLOW = '.github/workflows/dependency-watch.yml';
const DEPENDABOT = '.github/dependabot.yml';
const SCRIPT_DIR = '.github/dependency-watch';
// The workflow's runtime check imports these; they ship together and import only node: builtins.
const SCRIPTS = ['cli.ts', 'patch.ts', 'pins.ts', 'releases.ts', 'versions.ts', 'runtime-check.ts', 'report.ts'];

const DEFAULT_SCHEDULE = '17 6 * * *';
// The template uses single quotes; an owner's hand edit may use double quotes or none.
const CRON_LINE = /- cron:[ \t]*(['"]?)([^'"#\n]*?)\1[ \t]*(#.*)?$/m;
const CRON_FIELD = /^[0-9A-Za-z*/,-]+$/;
const CRON_FIELDS = 5;

// Lockfile / manifest basename → Dependabot package-ecosystem.
const ECOSYSTEM_FILES: Record<string, string> = {
  'Gemfile.lock': 'bundler',
  'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', 'yarn.lock': 'npm', 'pnpm-lock.yaml': 'npm', 'bun.lock': 'bun',
  'Cargo.lock': 'cargo', 'go.mod': 'gomod', 'composer.lock': 'composer',
  'Pipfile.lock': 'pip', 'poetry.lock': 'pip', 'uv.lock': 'uv',
};
const REQUIREMENTS = /^requirements.*\.txt$/;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

export type FileState = 'none' | 'foreign' | 'scaffold' | 'stale';
export interface Ecosystem { ecosystem: string; directories: string[]; }
export interface Detection {
  ecosystems: Ecosystem[];
  runtimePins: Pick<Pin, 'file' | 'line' | 'runtime' | 'state'>[];
  files: { path: string; state: FileState }[];
}
interface Rendered { path: string; content: string; }

export function validateSchedule(cron: string, source = '--schedule'): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== CRON_FIELDS || !fields.every(f => CRON_FIELD.test(f))) {
    throw new Error(`${source} must be a 5-field cron expression, got "${cron}"`);
  }
  return fields.join(' ');
}

function ecosystemOf(path: string): string | undefined {
  const name = basename(path);
  if (WORKFLOW_FILE.test(path)) return 'github-actions';
  return ECOSYSTEM_FILES[name] ?? (REQUIREMENTS.test(name) ? 'pip' : undefined);
}

function detectEcosystems(tracked: string[]): Ecosystem[] {
  const byEcosystem = new Map<string, Set<string>>();
  for (const path of tracked) {
    const ecosystem = ecosystemOf(path);
    if (!ecosystem) continue;
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
    // Required by zizmor (dependabot-cooldown). Cooldown only delays version updates, which are
    // off; security updates ignore it.
    '    cooldown:',
    '      default-days: 7',
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
function currentSchedule(repo: string): string | undefined {
  const cron = CRON_LINE.exec(readIfExists(join(repo, WORKFLOW)) ?? '')?.[2];
  return cron === undefined ? undefined : validateSchedule(cron, `the cron in ${WORKFLOW}`);
}

function render(repo: string, srcRoot: string, ecosystems: Ecosystem[], schedule?: string): Rendered[] {
  const cron = schedule ?? currentSchedule(repo) ?? DEFAULT_SCHEDULE;
  const template = (name: string): string => readFileSync(join(srcRoot, TEMPLATE_DIR, name), 'utf8');
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
  const ecosystems = detectEcosystems(tracked);
  return {
    ecosystems,
    runtimePins: trackedPins(repo, tracked).map(p => ({ file: p.file, line: p.line, runtime: p.runtime, state: p.state })),
    files: render(repo, srcRoot, ecosystems).map(file => ({ path: file.path, state: stateOf(repo, file) })),
  };
}

export interface EmitOptions { schedule?: string; force: boolean; }

export function emit(repo: string, srcRoot: string, options: EmitOptions): WriteResult[] {
  const results: WriteResult[] = [];
  const kept = loadKeep(repo);
  for (const file of render(repo, srcRoot, detectEcosystems(trackedFiles(repo)), options.schedule)) {
    safeWrite(repo, file.path, file.content, kept, results, options.force);
  }
  return results;
}
