#!/usr/bin/env node
// delivery-metrics.ts — measure delivery, not output.
//
// Agents make code cheap; knowing whether to trust it is not. So the signal worth tracking is how merged
// work flows, not how much of it was written: merges per week, open-to-merge time, the gap between green
// CI and the merge (time spent waiting on a person), and whether change requests were followed by a commit.
// Reads merged PRs through the GitHub REST API with `gh`, so it works where GraphQL is unavailable.
//
//   node scripts/delivery-metrics.ts [--repo owner/name] [--days 30]

import { execFileSync } from 'node:child_process';

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
    `${repo}: ${m.merged} merged PRs (${m.mergesPerWeek.toFixed(1)}/week)`,
    `  open → merge: median ${hours(m.openToMergeHours)}`,
    `  green CI → merge: median ${hours(m.greenToMergeHours)}  (time waiting on a person after the machines agreed)`,
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = arg('--repo') ?? repoFromRemote(execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }));
  const days = Number(arg('--days') ?? DEFAULT_DAYS);
  if (!repo || !isRepo(repo) || !(days > 0)) {
    console.error('usage: delivery-metrics.ts [--repo owner/name] [--days N]');
    process.exit(2);
  }
  // API fields go into request paths; take only well-formed ones.
  const pulls = mergedSince(repo, Date.now() - days * DAY_MS).filter(p => Number.isInteger(p.number) && SHA.test(p.head.sha));
  console.log(format(metrics(pulls.map(p => fetchPr(repo, p)), days), repo));
}
