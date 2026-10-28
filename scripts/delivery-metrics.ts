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
  /** When the last check run on the merged head completed; null when none ran. */
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

const HOUR_MS = 3_600_000;
const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const DEFAULT_DAYS = 30;
/** GitHub REST's largest page; one page covers a typical window. */
const PAGE = 'per_page=100';
// quality-ok: magic-number — 64 MiB of JSON
const MAX_BUFFER = 64 * 1024 * 1024;
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
  const unaddressed: number[] = [];
  for (const p of merged) {
    for (const at of p.changeRequestsAt) {
      changeRequests.total++;
      if (p.commitsAt.some(c => c > at)) changeRequests.followedByCommit++;
      else if (!unaddressed.includes(p.number)) unaddressed.push(p.number);
    }
  }
  return {
    merged: merged.length,
    mergesPerWeek: merged.length / (days / DAYS_PER_WEEK),
    openToMergeHours: median(merged.map(p => hoursBetween(p.createdAt, p.mergedAt))),
    greenToMergeHours: median(merged.filter(p => p.checksDoneAt).map(p => hoursBetween(p.checksDoneAt as string, p.mergedAt))),
    changeRequests,
    unaddressed,
  };
}

const MINUTES_PER_HOUR = 60;
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

export function repoFromRemote(url: string): string | null {
  const m = /[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function ghJson<T>(path: string): T {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: MAX_BUFFER })) as T;
}

interface GhPull { number: number; created_at: string; merged_at: string | null; head: { sha: string } }

function fetchPr(repo: string, p: GhPull): PrRecord {
  const runs = ghJson<{ check_runs: { completed_at: string | null }[] }>(`repos/${repo}/commits/${p.head.sha}/check-runs?${PAGE}`);
  const done = runs.check_runs.map(r => r.completed_at).filter((t): t is string => t !== null).sort();
  const reviews = ghJson<{ state: string; submitted_at: string }[]>(`repos/${repo}/pulls/${p.number}/reviews?${PAGE}`);
  const commits = ghJson<{ commit: { committer: { date: string } } }[]>(`repos/${repo}/pulls/${p.number}/commits?${PAGE}`);
  return {
    number: p.number,
    createdAt: p.created_at,
    mergedAt: p.merged_at,
    checksDoneAt: done.at(-1) ?? null,
    changeRequestsAt: reviews.filter(r => r.state === 'CHANGES_REQUESTED').map(r => r.submitted_at),
    commitsAt: commits.map(c => c.commit.committer.date),
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const repo = arg('--repo') ?? repoFromRemote(remote);
  const days = Number(arg('--days') ?? DEFAULT_DAYS);
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !(days > 0)) {
    console.error('usage: delivery-metrics.ts [--repo owner/name] [--days N]');
    process.exit(2);
  }
  const since = Date.now() - days * HOURS_PER_DAY * HOUR_MS;
  const pulls = ghJson<GhPull[]>(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&${PAGE}`)
    .filter(p => p.merged_at && Date.parse(p.merged_at) >= since);
  console.log(format(metrics(pulls.map(p => fetchPr(repo, p)), days), repo));
}
