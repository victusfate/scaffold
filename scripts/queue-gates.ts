// Queue gate CLI actions and their shared drain-restart hint.
import { save, log } from './queue-io.ts';
import { gateTasks, ungateTasks, markDone, drainSignal, type Queue } from './queue-model.ts';

/**
 * `queue gate <gate-id> [--only <filter>] [--dry-run]` — the mechanical form of a
 * temporary priority block: add `deps: <gate-id>` to every other unfinished task
 * so nothing runs until the gate is done. Idempotent, cycle-safe, filterable.
 * `--dry-run` prints the plan without writing. Replaces hand-editing `queue.md`.
 */
export function cmdGate(q: Queue, gateId: string, only: string, dryRun: boolean): number {
  if (!gateId) { console.error('usage: queue gate <gate-id> [--only <filter>] [--dry-run]'); return 1; }
  if (!q.tasks.some(t => t.id === gateId)) { console.error(`gate: unknown gate task id ${gateId}`); return 1; }
  const { queue, gated } = gateTasks(q, gateId, only || undefined);
  const scope = only ? ` matching "${only}"` : '';
  if (dryRun) {
    console.log(`gate (dry-run): would gate ${gated.length} task(s)${scope} behind ${gateId}`
      + (gated.length ? `\n  ${gated.join(', ')}` : ''));
    return 0;
  }
  save(queue); log(`gate ${gateId} → ${gated.length} task(s)${scope}`);
  console.log(`gated ${gated.length} task(s)${scope} behind ${gateId}`
    + (gated.length ? ` (${gated.join(', ')})` : ' (nothing to gate)'));
  return 0;
}

/**
 * `queue ungate <gate-id> [--keep-gate] [--dry-run]` — lift a gate: strip
 * `<gate-id>` from every task's deps and, unless `--keep-gate`, mark the gate task
 * done so its blocked dependents become eligible. The mechanical way to open a
 * block like the model-fidelity gate (never text-edit `queue.md`).
 */
export function cmdUngate(q: Queue, gateId: string, keepGate: boolean, dryRun: boolean): number {
  if (!gateId) { console.error('usage: queue ungate <gate-id> [--keep-gate] [--dry-run]'); return 1; }
  const gate = q.tasks.find(t => t.id === gateId);
  const { queue, ungated } = ungateTasks(q, gateId);
  const markGate = gate && !keepGate && gate.status !== 'done';
  if (dryRun) {
    console.log(`ungate (dry-run): would ungate ${ungated.length} task(s) from ${gateId}`
      + (markGate ? ` and mark ${gateId} done` : '')
      + (ungated.length ? `\n  ${ungated.join(', ')}` : ''));
    return 0;
  }
  const finalQ = markGate ? markDone(queue, gateId) : queue;
  save(finalQ); log(`ungate ${gateId} → ${ungated.length} task(s)${markGate ? ' + done' : ''}`);
  console.log(`ungated ${ungated.length} task(s) from ${gateId}`
    + (markGate ? `; ${gateId} marked done` : '')
    + drainKick(finalQ));
  return 0;
}

/**
 * Emit the stable DRAIN-WANTED marker (plus a human hint) when a mutation leaves a
 * running queue drainable with no driver attached. This is a machine signal — a
 * Monitor on the queue file, a cron, or an agent keys on `queue: DRAIN-WANTED` to
 * (re)start the drain — not just prose a human has to be watching to notice. Empty
 * string when a driver is already active, nothing is eligible, or the queue is
 * stopped/paused (an operator halt is not a stalled drain).
 */
export function drainKick(q: Queue): string {
  const sig = drainSignal(q);
  return sig ? `\n${sig}  → start now: \`node scripts/queue.ts tick\` (or the loop)` : '';
}
