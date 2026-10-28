import assert from 'node:assert/strict';
import { metrics, median, repoFromRemote, format, type PrRecord } from './delivery-metrics.ts';

assert.equal(median([]), null);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([1, 2, 3, 4]), 2.5);

assert.equal(repoFromRemote('git@github.com:victusfate/scaffold.git'), 'victusfate/scaffold');
assert.equal(repoFromRemote('https://github.com/victusfate/scaffold'), 'victusfate/scaffold');
assert.equal(repoFromRemote('http://proxy@127.0.0.1:1234/git/victusfate/scaffold'), 'victusfate/scaffold');
assert.equal(repoFromRemote('not a url'), null);

const h = (hours: number) => new Date(Date.UTC(2026, 9, 1) + hours * 3600_000).toISOString();
const prs: PrRecord[] = [
  // Opened at 0, CI green at 2, merged at 10; a change request at 3 was followed by a commit at 4.
  { number: 1, createdAt: h(0), mergedAt: h(10), checksDoneAt: h(2), changeRequestsAt: [h(3)], commitsAt: [h(1), h(4)] },
  // Opened at 0, CI green at 20, merged at 24; a change request at 21 had no commit after it.
  { number: 2, createdAt: h(0), mergedAt: h(24), checksDoneAt: h(20), changeRequestsAt: [h(21)], commitsAt: [h(1)] },
  // No checks ran, no reviews.
  { number: 3, createdAt: h(0), mergedAt: h(6), checksDoneAt: null, changeRequestsAt: [], commitsAt: [h(1)] },
  // Closed unmerged: not counted anywhere.
  { number: 4, createdAt: h(0), mergedAt: null, checksDoneAt: h(1), changeRequestsAt: [], commitsAt: [h(1)] },
];
const m = metrics(prs, 7);
assert.equal(m.merged, 3);
assert.equal(m.mergesPerWeek, 3);
assert.equal(m.openToMergeHours, 10);
// Green-to-merge only counts PRs whose checks ran: 8h and 4h.
assert.equal(m.greenToMergeHours, 6);
assert.deepEqual(m.changeRequests, { total: 2, followedByCommit: 1 });
assert.deepEqual(m.unaddressed, [2]);

const out = format(m, 'o/r');
assert.match(out, /o\/r: 3 merged PRs/);
assert.match(out, /green CI → merge: median 6\.0h/);
assert.match(out, /1 of 2 followed by a commit/);
assert.match(out, /#2/);

// An empty window reports nothing rather than dividing by zero.
const none = metrics([], 7);
assert.equal(none.merged, 0);
assert.equal(none.openToMergeHours, null);
assert.match(format(none, 'o/r'), /n\/a/);
assert.match(format({ ...m, openToMergeHours: 0.05 }, 'o/r'), /open → merge: median 3m/);

console.log('delivery-metrics.test: ok');
