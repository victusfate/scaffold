// queue-links.ts — `queue links [--fix]`: a task links only a live working branch.
// An empty branch means the task is on main. A link to a branch that no longer exists (merged and
// deleted, or set before a lane that never started) is a stale fact: it misleads dispatch and
// branch-cap accounting. `links` reports them (exit 1); `--fix` clears them (the task keeps its status).

import { execSync } from 'node:child_process';
import { ROOT, save, log } from './queue-io.ts';
import { setField, type Queue } from './queue-model.ts';

export function danglingLinks(q: Queue, liveBranches: ReadonlySet<string>): { id: string; branch: string }[] {
  return q.tasks.flatMap(t =>
    t.status !== 'done' && t.branch && !liveBranches.has(t.branch) ? [{ id: t.id, branch: t.branch }] : []);
}

function localBranches(): Set<string> {
  const out = execSync("git for-each-ref --format='%(refname:short)' refs/heads", { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  return new Set(out.split('\n').map(s => s.trim()).filter(Boolean));
}

export function cmdLinks(q: Queue, fix: boolean, branches: ReadonlySet<string> = localBranches()): number {
  const stale = danglingLinks(q, branches);
  if (stale.length === 0) { console.log('queue links: every task branch link names a live branch'); return 0; }
  for (const s of stale) console.log(`${fix ? 'cleared' : 'DANGLING'} ${s.id} -> ${s.branch} (branch gone)`);
  if (!fix) { console.log('queue links: run `queue links --fix` to clear them (tasks keep their status)'); return 1; }
  let next = q;
  for (const s of stale) next = setField(next, s.id, { branch: '' });
  save(next); log(`links: cleared ${stale.length} dangling branch link(s)`);
  return 0;
}
