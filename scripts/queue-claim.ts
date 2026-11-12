// Queue claim CLI action: a worker (or a topology slot) takes a pending task. `--branch` links the
// worker's branch in the same write as the claim, so a slot's task never sits active with an unlinked
// branch (the Slots panel and branch accounting read this link).
import { save, log, now } from './queue-io.ts';
import { beginTask, setField, deliveryAllows, type Queue, type Task } from './queue-model.ts';

/** Why `t` can't be claimed now, or null when it can (printed to stdout, as before the split). */
function refusal(q: Queue, t: Task): { message: string; stderr: boolean } | null {
  if (t.status !== 'pending') return { message: `claim: ${t.id} is ${t.status}, not claimable`, stderr: false };
  if (!deliveryAllows(q, t.id)) return { message: 'claim: current delivery cycle must finish first', stderr: true };
  if (t.held) return { message: `claim: ${t.id} is held — unhold it first`, stderr: false };
  return null;
}

/** The --branch value: '' when absent, null when given but not one branch name. */
function branchFlag(flags: Map<string, string>): string | null {
  if (!flags.has('branch')) return '';
  const branch = flags.get('branch')?.trim() ?? '';
  return branch && !/\s/.test(branch) ? branch : null;
}

/**
 * `queue claim <id> [--worker w] [--branch b]`. Returns the process exit code. The caller passes its task
 * printer, so consumers whose queue keeps `taskBlock` in another module sync this file unchanged.
 */
export function cmdClaim(q: Queue, id: string, flags: Map<string, string>, taskBlock: (t: Task) => string): number {
  const t = q.tasks.find(x => x.id === id)!;
  const refused = refusal(q, t);
  if (refused) { (refused.stderr ? console.error : console.log)(refused.message); return 1; }
  const branch = branchFlag(flags);
  if (branch === null) { console.error('claim: --branch needs one branch name'); return 1; }
  const worker = flags.get('worker') ?? `worker-${process.pid}`;
  const on = branch ? ` on ${branch}` : '';
  save(branch ? setField(beginTask(q, id, now(), worker), id, { branch }) : beginTask(q, id, now(), worker));
  log(`claim ${id} by ${worker}${on}`);
  console.log(`claimed ${id} for ${worker}${on}\n${taskBlock({ ...t, owner: worker, branch: branch || t.branch })}`);
  return 0;
}
