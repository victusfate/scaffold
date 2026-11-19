#!/usr/bin/env node
// scaffold-dependency-watch: shipped to consumer repos as .github/dependency-watch/report.ts
// Tracking-issue report: merge runtime-check and osv-scanner JSON into one markdown body.
// Only structured fields reach the body (ids, packages, versions, files, links). Advisory summaries
// and details are untrusted prose and are never read, so they cannot become agent instructions.
//
//   node report.ts --runtime <json> --body-out <md> [--osv <json>] [--root <dir>] [--run-url <url>]
//   writes the issue body to --body-out; stdout: the status, `clean` or `findings`

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isEntryPoint, todayIso } from './cli.ts';
import { eolPageUrl, releaseNotesUrl } from './releases.ts';
import type { Classification, Finding, Note } from './versions.ts';

// The workflow finds its one tracking issue by label; the marker identifies the body as generated.
export const ISSUE_MARKER = '<!-- dependency-watch -->';
const EXIT_ERROR = 2;
const MAX_PACKAGE_ROWS = 200;
const MAX_IDS_PER_ROW = 10;
const MAX_FIXED_PER_ROW = 5;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const SAFE_VERSION = /^[A-Za-z0-9.+_~:-]+$/;
const OSV_LINK = 'https://osv.dev/vulnerability/';

interface OsvPackage { name: string; version: string; ecosystem: string; }
interface OsvVuln {
  id: string;
  affected?: { package?: Partial<OsvPackage>; ranges?: { events?: { fixed?: string }[] }[] }[];
}
export interface OsvOutput {
  results: { source: { path: string }; packages: { package: OsvPackage; vulnerabilities: OsvVuln[] }[] }[];
}

export interface ReportInput { runtime: Classification; osv: OsvOutput; }
export interface ReportOptions { root: string; runUrl: string; date: string; }
export interface Report { status: 'clean' | 'findings'; body: string; }

interface PackageRow { file: string; pkg: OsvPackage; ids: string[]; fixed: string[]; }

// Text goes in a table cell: keep it on one line and inert. Names and versions are wrapped in code
// spans too, so scoped packages (`@org/pkg`) cannot become mentions and nothing renders as a link.
const cell = (text: string): string =>
  text.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").replace(/</g, '&lt;').replace(/\|/g, '\\|');
// Inside a code span markdown and HTML do not render, so only the span and the row need guarding.
const code = (text: string): string => `\`${text.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").replace(/\|/g, '\\|')}\``;
const byText = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });
const capped = (items: string[], max: number): string =>
  items.slice(0, max).join(', ') + (items.length > max ? `, +${items.length - max} more` : '');

function fixedVersions(vuln: OsvVuln, pkg: OsvPackage): string[] {
  return (vuln.affected ?? [])
    .filter(a => a.package?.name === pkg.name && a.package?.ecosystem === pkg.ecosystem)
    .flatMap(a => a.ranges ?? []).flatMap(r => r.events ?? [])
    .flatMap(e => e.fixed && SAFE_VERSION.test(e.fixed) ? [e.fixed] : []);
}

function packageRows(osv: OsvOutput, root: string): PackageRow[] {
  const prefix = resolve(root) + '/';
  const rows = osv.results.flatMap(result => result.packages
    .filter(p => p.vulnerabilities.length > 0)
    .map(p => ({
      file: result.source.path.startsWith(prefix) ? result.source.path.slice(prefix.length) : result.source.path,
      pkg: p.package,
      ids: [...new Set(p.vulnerabilities.map(v => v.id).filter(id => SAFE_ID.test(id)))].sort(byText),
      // Highest first: those clear the most advisories. Ordering is display only, never a decision.
      fixed: [...new Set(p.vulnerabilities.flatMap(v => fixedVersions(v, p.package)))].sort(byText).reverse(),
    })));
  return rows.sort((a, b) => byText(`${a.file} ${a.pkg.name} ${a.pkg.version}`, `${b.file} ${b.pkg.name} ${b.pkg.version}`));
}

// `latest` passed the release-list version check, so it is safe inside a link.
const describe = (f: Finding): string => f.kind === 'behind'
  ? `behind: latest patch is [${f.latest}](${releaseNotesUrl(f.runtime, f.latest)})`
  : `end of life${f.since ? ` since ${cell(f.since)}` : ''} ([schedule](${eolPageUrl(f.runtime)}))`;

type Located = { file: string; line: number };
const where = (s: Located): string => code(`${s.file}:${s.line}`);
const byLocation = (a: Located, b: Located): number => byText(a.file, b.file) || a.line - b.line;

function runtimeSection(findings: Finding[]): string[] {
  if (!findings.length) return ['### Runtime pins', '', 'No findings.'];
  const rows = [...findings].sort((a, b) => byLocation(a, b) || byText(a.kind, b.kind))
    .map(f => `| ${where(f)} | ${f.runtime} | ${cell(f.pinned)} | ${describe(f)} |`);
  return [`### Runtime pins (${findings.length})`, '', '| Where | Runtime | Pinned | Finding |', '|---|---|---|---|', ...rows];
}

function packageSection(rows: PackageRow[]): string[] {
  if (!rows.length) return ['### Packages', '', 'No known vulnerabilities.'];
  const shown = rows.slice(0, MAX_PACKAGE_ROWS).map(r => {
    const ids = capped(r.ids.map(id => `[${id}](${OSV_LINK}${id})`), MAX_IDS_PER_ROW);
    return `| ${code(r.file)} | ${code(r.pkg.name)} | ${code(r.pkg.version)} | ${cell(r.pkg.ecosystem)} | ${ids} | ${capped(r.fixed, MAX_FIXED_PER_ROW) || '—'} |`;
  });
  const rest = rows.length - shown.length;
  return [`### Packages (${rows.length})`, '', '| File | Package | Version | Ecosystem | Advisories | Fixed in |',
    '|---|---|---|---|---|---|', ...shown, ...(rest > 0 ? ['', `…and ${rest} more packages (see the workflow run).`] : [])];
}

function notesSection(notes: Note[]): string[] {
  if (!notes.length) return [];
  const lines = [...notes].sort(byLocation).map(n => `- ${where(n)}${n.runtime ? ` ${n.runtime}` : ''}: ${cell(n.reason)}`);
  return ['', '### Not checked', '', ...lines];
}

function patchSection(findings: Finding[], packages: number): string[] {
  const bumps = findings.filter(f => f.kind === 'behind').length;
  const eol = findings.length - bumps;
  if (!findings.length && !packages) return [];
  const steps = [
    ...(bumps ? [`Tell your agent \`/dependency-watch fix\`: it bumps ${bumps} runtime pin(s) to the latest patch and opens a PR for you to merge.`] : []),
    ...(packages ? ['Dependabot opens security PRs for the packages.'] : []),
    ...(eol ? [`${eol} end-of-life line(s) need a decision: move to a supported line in a normal PR.`] : []),
  ];
  return ['', '### To patch', '', ...steps.map(s => `- ${s}`)];
}

export function buildReport(input: ReportInput, options: ReportOptions): Report {
  const rows = packageRows(input.osv, options.root);
  const status = input.runtime.findings.length || rows.length ? 'findings' : 'clean';
  const body = [
    ISSUE_MARKER,
    '## Dependency watch',
    '',
    `Last run ${options.date}: [workflow run](${options.runUrl}). This issue is rewritten on every run and closed when a run is clean.`,
    '',
    ...runtimeSection(input.runtime.findings),
    '',
    ...packageSection(rows),
    ...notesSection(input.runtime.unchecked),
    ...patchSection(input.runtime.findings, rows.length),
    '',
    'Suppress a reviewed false positive in `osv-scanner.toml` with a reason.',
  ].join('\n');
  return { status, body };
}

function main(): void {
  const { values } = parseArgs({
    strict: true,
    options: {
      runtime: { type: 'string' }, osv: { type: 'string' }, root: { type: 'string' },
      'run-url': { type: 'string' }, 'body-out': { type: 'string' },
    },
  });
  if (!values.runtime || !values['body-out']) throw new Error('--runtime <json> and --body-out <md> are required');
  const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
  const report = buildReport(
    { runtime: readJson<Classification>(values.runtime), osv: values.osv ? readJson<OsvOutput>(values.osv) : { results: [] } },
    { root: values.root ?? '.', runUrl: values['run-url'] ?? '', date: todayIso() },
  );
  writeFileSync(values['body-out'], report.body + '\n');
  process.stdout.write(report.status + '\n');
}

if (isEntryPoint(import.meta.url)) {
  try { main(); } catch (error) { console.error(`report: ${(error as Error).message}`); process.exitCode = EXIT_ERROR; }
}
