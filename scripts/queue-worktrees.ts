// queue-worktrees.ts — `queue worktree add|remove|list`: an isolated git
// worktree per task on branch `queue/<id>`. Split out of queue.ts; the CLI
// dispatcher calls cmdWorktree under the queue lock.

import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ROOT, save, log } from './queue-io.ts';
import { setField, type Queue } from './queue-model.ts';

function git(args: string, cwd = ROOT): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}
function currentBranch(): string {
  try { return git('rev-parse --abbrev-ref HEAD'); } catch { return 'main'; }
}
function wtRel(id: string): string { return join('.agent', 'queue', 'wt', id); }

/**
 * Create an isolated git worktree for a task on branch `queue/<id>`, cut from the
 * integration base (config.integrationBranch, or the current branch). Records the
 * branch + worktree path on the task. Merge-back is deliberately agent-driven
 * (see skills/queue.md, aligned with design.md D7) — the CLI never auto-merges.
 */
function cmdWorktreeAdd(q: Queue, id: string): number {
  const t = q.tasks.find(x => x.id === id);
  if (!t) { console.error(`worktree add: unknown task id ${id}`); return 1; }
  const base = q.config.integrationBranch || currentBranch();
  const branch = `queue/${id}`;
  const rel = wtRel(id);
  const abs = join(ROOT, rel);
  try {
    try { git(`worktree add ${abs} -b ${branch} ${base}`); }
    catch { git(`worktree add ${abs} ${branch}`); } // branch already exists
  } catch (e) { console.error(`worktree add failed: ${(e as Error).message}`); return 1; }
  save(setField(q, id, { branch, worktree: rel }));
  log(`worktree add ${id} → ${rel} (${branch} off ${base})`);
  console.log(`worktree ready: ${rel}  on ${branch}  (base ${base})\n`
    + `cd ${rel} to work in isolation; on success merge ${branch} → ${base}, then `
    + `\`node scripts/queue.ts worktree remove ${id}\``);
  return 0;
}

function cmdWorktreeRemove(q: Queue, id: string): number {
  const t = q.tasks.find(x => x.id === id);
  const rel = t?.worktree ?? wtRel(id);
  try { git(`worktree remove --force ${join(ROOT, rel)}`); } catch { /* already gone */ }
  if (t) save(setField(q, id, { worktree: null }));
  log(`worktree remove ${id}`);
  console.log(`removed worktree for ${id}`);
  return 0;
}

export function cmdWorktree(q: Queue, sub: string, id: string): number {
  if (sub === 'add') return cmdWorktreeAdd(q, id);
  if (sub === 'remove' || sub === 'rm') return cmdWorktreeRemove(q, id);
  if (sub === 'list') { console.log(git('worktree list')); return 0; }
  console.error('usage: queue worktree add|remove|list <id>');
  return 1;
}
