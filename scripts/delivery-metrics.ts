#!/usr/bin/env node
// delivery-metrics.ts — measure delivery, not output.
//
// Agents make code cheap; knowing whether to trust it is not. So the signal worth tracking is how merged
// work flows, not how much of it was written: merges per week, open-to-merge time, the gap between green
// CI and the merge (time spent waiting on a person), and whether change requests were followed by a commit.
// Reads merged PRs through the GitHub REST API with `gh`, so it works where GraphQL is unavailable.
//
//   node scripts/delivery-metrics.ts [--repo owner/name] [--days 30]
//   node scripts/delivery-metrics.ts --local-only [--rigor-log .agent/rigor.jsonl]
//   node scripts/delivery-metrics.ts --record-stage lint --unit task-1 --attempt 1 -- npm run lint
//   node scripts/delivery-metrics.ts --review-stage <id> --false-positive --evidence "minimized repro"
// Logs contain no command argv/output. Review judgments are explicit, never inferred from failure.

import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRigor, rigorMetrics, formatRigor } from './delivery-rigor.ts';
import { option, rigorAction } from './delivery-rigor-cli.ts';

export interface PrRecord {
  number: number;
  createdAt: string;
  mergedAt: string | null;
  /** When every check run on the merged head had passed; null when none ran or one did not pass. */
  checksDoneAt: string | null;
  changeRequestsAt: string[];
  commitsAt: string[];
}

export interface Metrics {
  merged: number;
  mergesPerWeek: number;
  openToMergeHours: number | null;
  greenToMergeHours: number | null;
  changeRequests: { total: number; followedByCommit: number };
  /** PRs with a change request that no later commit answered. */
  unaddressed: number[];
}

const MINUTES_PER_HOUR = 60;
const HOUR_MS = MINUTES_PER_HOUR * 60_000;
const DAY_MS = 24 * HOUR_MS;
const DAYS_PER_WEEK = 7;
const DEFAULT_DAYS = 30;
/** GitHub REST's largest page. */
const PER_PAGE = 100;
// quality-ok: magic-number — 64 MiB of JSON
const MAX_BUFFER = 64 * 1024 * 1024;
const PASSED = new Set(['success', 'neutral', 'skipped']);
/** One `owner` or `name` segment: GitHub's charset, and never all dots (`..` would walk the API path). */
const SEGMENT = '(?!\\.+(?:/|$))[\\w.-]+';
const REPO = new RegExp(`^${SEGMENT}/${SEGMENT}$`);
const SHA = /^[0-9a-f]{40}$/;

const hoursBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / HOUR_MS;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function metrics(prs: PrRecord[], days: number): Metrics {
  const merged = prs.filter((p): p is PrRecord & { mergedAt: string } => p.mergedAt !== null);
  const changeRequests = { total: 0, followedByCommit: 0 };
  const unaddressed = new Set<number>();
  for (const p of merged) {
    for (const at of p.changeRequestsAt) {
      changeRequests.total++;
      if (p.commitsAt.some(c => c > at)) changeRequests.followedByCommit++;
      else unaddressed.add(p.number);
    }
  }
  return {
    merged: merged.length,
    mergesPerWeek: merged.length * DAYS_PER_WEEK / days,
    openToMergeHours: median(merged.map(p => hoursBetween(p.createdAt, p.mergedAt))),
    greenToMergeHours: median(merged.flatMap(p => (p.checksDoneAt ? [hoursBetween(p.checksDoneAt, p.mergedAt)] : []))),
    changeRequests,
    unaddressed: [...unaddressed],
  };
}

const hours = (h: number | null) =>
  h === null ? 'n/a' : h < 1 ? `${Math.round(h * MINUTES_PER_HOUR)}m` : `${h.toFixed(1)}h`;

export function format(m: Metrics, repo: string): string {
  const cr = m.changeRequests;
  return [
    'Operational flow signals (do not establish customer success):',
    `${repo}: ${m.merged} merged PRs (${m.mergesPerWeek.toFixed(1)}/week)`,
    `  open → merge: median ${hours(m.openToMergeHours)}`,
    `  green CI → merge: median ${hours(m.greenToMergeHours)}  (time waiting on a person after the machines agreed)`,
    'Outcome/risk/learning evidence: not measured here; see feature design/QA evidence.',
    `  change requests: ${cr.followedByCommit} of ${cr.total} followed by a commit`
      + (m.unaddressed.length ? `; unanswered on ${m.unaddressed.map(n => `#${n}`).join(', ')}` : ''),
  ].join('\n');
}

export const isRepo = (s: string) => REPO.test(s);

export function repoFromRemote(url: string): string | null {
  const m = /[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m && isRepo(m[1]) ? m[1] : null;
}

/** When the head went green: the last completion, provided every run finished and passed. */
export function greenAt(runs: { completed_at: string | null; conclusion: string | null }[]): string | null {
  if (!runs.length || runs.some(r => !r.completed_at || !PASSED.has(r.conclusion ?? ''))) return null;
  return runs.map(r => r.completed_at as string).sort().at(-1) ?? null;
}

function ghJson<T>(path: string): T {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: MAX_BUFFER })) as T;
}

interface GhPull { number: number; created_at: string; merged_at: string | null; updated_at: string; head: { sha: string } }

function fetchPr(repo: string, p: GhPull): PrRecord {
  const runs = ghJson<{ check_runs: Parameters<typeof greenAt>[0] }>(`repos/${repo}/commits/${p.head.sha}/check-runs?per_page=${PER_PAGE}`);
  const reviews = ghJson<{ state: string; submitted_at: string }[]>(`repos/${repo}/pulls/${p.number}/reviews?per_page=${PER_PAGE}`);
  const commits = ghJson<{ commit: { committer: { date: string } } }[]>(`repos/${repo}/pulls/${p.number}/commits?per_page=${PER_PAGE}`);
  return {
    number: p.number,
    createdAt: p.created_at,
    mergedAt: p.merged_at,
    checksDoneAt: greenAt(runs.check_runs),
    changeRequestsAt: reviews.filter(r => r.state === 'CHANGES_REQUESTED').map(r => r.submitted_at),
    commitsAt: commits.map(c => c.commit.committer.date),
  };
}

/** Closed PRs merged since `since`, paging (most recently updated first) until a page predates the window. */
function mergedSince(repo: string, since: number): GhPull[] {
  const out: GhPull[] = [];
  for (let page = 1; ; page++) {
    const pulls = ghJson<GhPull[]>(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`);
    out.push(...pulls.filter(p => p.merged_at && Date.parse(p.merged_at) >= since));
    if (pulls.length < PER_PAGE || Date.parse(pulls[pulls.length - 1].updated_at) < since) return out;
  }
}

const HELP = `Usage: node scripts/delivery-metrics.ts [--repo owner/name] [--days N]
  --local-only                      Report local gate telemetry without GitHub access
  --rigor-log PATH                   JSONL file (default: <repo>/.agent/rigor.jsonl)
  --record-stage NAME --unit ID --attempt N -- COMMAND [ARGS]
                                    Run COMMAND without a shell; preserve its exit status
  --review-stage ID --false-positive|--true-positive --evidence TEXT
                                    Adjudicate one failed attempt with explicit evidence
  --help                            Show this help without network access

Run recording/review commands from the repo root. Log writes must stay within cwd.
Use a stable unit per task/revision and increment attempt per stage on retries.
Records omit command argv/output. First-try pass uses recorded attempt 1 only.
False-positive rate uses reviewed failures only and includes review coverage.
Local costs cover all recorded dates; --days selects the merged-PR window only.
Operational throughput/cost do not establish customer outcomes or delivered value.`;

function validateFlags(args: string[]): void {
  const values = new Set(['--repo', '--days', '--rigor-log', '--record-stage', '--unit', '--attempt', '--review-stage', '--evidence']);
  const booleans = new Set(['--local-only', '--false-positive', '--true-positive', '--help']);
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (seen.has(name)) throw new Error(`duplicate ${name}`);
    seen.add(name);
    if (values.has(name)) { option(args, name); i++; }
    else if (!booleans.has(name)) throw new Error(`unknown flag: ${name}`);
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function remoteReport(flags: string[]): string {
  const arg = (name: string) => option(flags, name);
  const repo = arg('--repo') ?? repoFromRemote(execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }));
  const days = Number(arg('--days') ?? DEFAULT_DAYS);
  if (!repo || !isRepo(repo) || !(days > 0) || !Number.isFinite(days)) {
    throw new Error(HELP);
  }
  // API fields go into request paths; take only well-formed ones.
  const pulls = mergedSince(repo, Date.now() - days * DAY_MS).filter(p => Number.isInteger(p.number) && SHA.test(p.head.sha));
  return format(metrics(pulls.map(p => fetchPr(repo, p)), days), repo);
}

function main(): number {
  const args = process.argv.slice(2);
  const separator = args.indexOf('--');
  const flags = separator < 0 ? args : args.slice(0, separator);
  if (separator >= 0 && !flags.includes('--record-stage')) throw new Error('-- command requires --record-stage');
  validateFlags(flags);
  if (flags.includes('--help')) { console.log(HELP); return 0; }
  const arg = (name: string) => option(flags, name);
  const log = arg('--rigor-log') ?? join(ROOT, '.agent', 'rigor.jsonl');
  const action = rigorAction(args, log);
  if (action !== null) return action;
  if (flags.some(flag => ['--unit', '--attempt', '--false-positive', '--true-positive', '--evidence'].includes(flag)))
    throw new Error('record/review metadata requires --record-stage or --review-stage');
  const cost = formatRigor(rigorMetrics(readRigor(log)));
  if (flags.includes('--local-only')) { console.log(cost); return 0; }
  console.log(remoteReport(flags));
  console.log(cost);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`delivery-metrics: ${String(error)}`); process.exitCode = 2; }
}
