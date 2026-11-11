// Slots panel model for the queue console (scripts/queue-console.ts): topology slots from .agent/topology.json
// joined with task status. Split from queue-console.ts at the slot/occupancy seam.

import { loadTopology, TopologyError, type Topology, type Slot } from './topology.ts';
import type { Queue } from './queue-model.ts';
import type { LaneView } from './queue-console.ts';

export interface SlotTask { id: string; title: string; startedAt: string | null }
/** One topology slot: busy iff an active task is owned by the slot id. Lane heartbeat is optional detail. */
export interface SlotView extends Slot {
  busy: boolean;
  /** More than one active task owned by this slot: a dispatch bug worth flagging. */
  overbooked: boolean;
  tasks: SlotTask[];
  lane: LaneView | null;
}
export interface ConsoleOrphan { id: string; title: string; owner: string | null }

/**
 * Derive slot occupancy from task status alone (owner = slot id), so the UI is only as true as the
 * orchestrator's task bookkeeping. Heartbeat sidecars, when present, attach as detail.
 */
export function slotViews(q: Queue, topology: Topology, lanes: LaneView[] = []): { slots: SlotView[]; orphans: ConsoleOrphan[] } {
  const active = q.tasks.filter(t => t.status === 'active');
  const slots = topology.slots.map(slot => {
    const mine = active.filter(t => t.owner === slot.id);
    const lane = lanes.find(l => mine.some(t => t.id === l.id)) ?? null;
    return {
      ...slot, busy: mine.length > 0, overbooked: mine.length > 1, lane,
      tasks: mine.map(t => ({ id: t.id, title: t.title, startedAt: t.startedAt })),
    };
  });
  const ids = new Set(topology.slots.map(s => s.id));
  const orphans = topology.slots.length === 0 ? [] : active.filter(t => !t.owner || !ids.has(t.owner))
    .map(t => ({ id: t.id, title: t.title, owner: t.owner }));
  return { slots, orphans };
}

/** Topology for the console: an invalid file is reported, not fatal. */
export function readTopology(): { topology: Topology | null; error: string | null } {
  try { return { topology: loadTopology(), error: null }; }
  catch (error) {
    if (!(error instanceof TopologyError)) throw error;
    return { topology: null, error: error.message };
  }
}
