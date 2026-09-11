#!/usr/bin/env node
// queue.ts — CLI + I/O for the agent work queue. Pure model lives in
// queue-model.ts; this file owns the filesystem, the clock, git worktrees, the
// audit log, and running validation commands.
//
//   node scripts/queue.ts list                       # show the queue
//   node scripts/queue.ts add "Do it" [flags]        # append a task (see flags below)
//   node scripts/queue.ts add-many                   # seed tasks from stdin, one per line
//   node scripts/queue.ts set <id> <field> <value>   # edit a task field
//   node scripts/queue.ts show <id>                  # print a task's full spec
//   node scripts/queue.ts next | ready               # serial pick | fan-out candidate set
//   node scripts/queue.ts tick                       # serial loop entry (ownership-check→begin→print)
//   node scripts/queue.ts signal                     # print DRAIN-WANTED iff drainable (Monitor poll)
//   node scripts/queue.ts claim <id> [--worker w]    # atomic claim for a parallel worker
//   node scripts/queue.ts done <id> [--skip-validate]# run validate, then complete
//   node scripts/queue.ts fail <id> [reason...]      # record a failure (retries then terminal)
//   node scripts/queue.ts top <id> | remove <id>
//   node scripts/queue.ts move <id> <pos>            # reorder to a 1-based position (as in `list`)
//   node scripts/queue.ts hold <id> | unhold <id>    # park a task (drain skips it) | release it
//   node scripts/queue.ts requeue <id>               # revive a failed task (pending, failures cleared)
//   node scripts/queue.ts start | stop               # run/pause the worker
//   node scripts/queue.ts interval 6m                # edit the wake interval
//   node scripts/queue.ts config <key> <value>       # maxFailures|leaseMinutes|maxParallel|integrationBranch
//   node scripts/queue.ts gate <gate-id> [--only f]  # deps: <gate-id> on every other task (block)
//   node scripts/queue.ts ungate <gate-id>           # remove <gate-id> from deps + mark it done (unblock)
//   node scripts/queue.ts archive                    # sweep done/failed into archive.md
//   node scripts/queue.ts loop                       # print the /loop invocation for this queue
//   node scripts/queue.ts lane beat|list|clear|stop|go <id>  # lane heartbeats (the live board reads these)
//
// add/set flags: --mode chain --slug <s> --deps a,b --files a,b --validate "<cmd>"
//   --accept "<criteria>" --top --worker <name>

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { execSync } from 'node:child_process';
import { ROOT, sidecar, now, load, save, log, appendArchive, withLock, unlocked } from './queue-io.ts';
import { cmdGate, cmdUngate, drainKick } from './queue-gates.ts';
import {
  render as renderModel,
  addTask, addMany, setField, moveToTop, moveTask, removeTask, setConfig,
  beginTask, markDone, recordFailure, staleLeases, pauseUntil, resumeIfDue, requeueTask,
  holdTask,
  nextActionable, readyTasks, deadlocked, drainSignal, archivableDone, taskFields,
  sweepFinished, NUMERIC_CONFIG_KEYS, TEXT_CONFIG_KEYS,
  type Queue, type Task,
} from './queue-model.ts';
import { parse, taskOverrides, SPEC_FLAGS } from './queue-cli-args.ts';
import { cmdLane } from './queue-lanes.ts';

// ---------------------------------------------------------------- flags

const MS_PER_MIN = 60000;

// Exit codes for the loop entry points (tick, ready, signal) so a driver can branch
// its next cadence without parsing text: 0 = work dispatched/wanted → continue;
// 3 = idle → back off to a long fallback; 4 = paused for a usage window → slow-poll;
// 5 = stopped → halt; 6 = ownership conflict → stop and report. A bare `return 1`
// stays the usage/error code.
const EXIT = { DISPATCHED: 0, IDLE: 3, PAUSED: 4, STOPPED: 5, CONFLICT: 6 } as const;

// ---------------------------------------------------------------- validation

/** Run a task's validation command; the worktree (if any) is the working dir. */
function runValidate(task: Task): { ok: boolean; tail: string } {
  const cmd = task.validate;
  if (!cmd) return { ok: true, tail: '' };
  const cwd = task.worktree ? join(ROOT, task.worktree) : process.cwd();
  try {
    execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });
    return { ok: true, tail: '' };
  } catch (e) {
    const out = String((e as { stdout?: string; stderr?: string }).stderr
      || (e as { stdout?: string }).stdout || (e as Error).message);
    return { ok: false, tail: out.trim().split('\n').slice(-3).join(' | ') };
  }
}

// ---------------------------------------------------------------- rendering

function showTask(t: Task): string {
  const rows = taskFields(t, true).map(([k, v]) => `  ${k}: ${v}`);
  return [`${t.id} [${t.status}] — ${t.title}`, ...rows].join('\n');
}

function taskBlock(t: Task): string {
  const spec = [
    t.mode === 'chain' ? 'mode: chain (design→prd→plan→tdd→refine, autonomous, no questions)' : 'mode: direct',
    t.slug ? `slug: docs/${t.slug}/` : '',
    t.accept ? `accept: ${t.accept}` : '',
    t.files.length ? `files: ${t.files.join(', ')}` : '',
    t.validate ? `validate: ${t.validate}` : '',
  ].filter(Boolean).join('\n');
  return `<queue_task id="${t.id}">\n${t.title}\n${spec}\n</queue_task>`;
}

// ---------------------------------------------------------------- commands

/**
 * Auto-resume a due usage pause, then report whether the queue is drainable.
 * Returns a blocking EXIT code for pauses or ambiguous ownership, or null to proceed.
 */
function dispatchGate(q: Queue): { queue: Queue; blocked: number | null } {
  const due = resumeIfDue(q, now());
  if (due.resumed) { q = due.queue; save(q); log('auto-resumed (usage window reopened)'); }
  if (q.config.status === 'stopped') {
    if (q.config.resumeAt) {
      console.log(`queue: PAUSED until ${q.config.resumeAt} (usage window) — auto-resumes after`);
      return { queue: q, blocked: EXIT.PAUSED };
    }
    console.log('queue: STOPPED — run `queue start` to resume');
    return { queue: q, blocked: EXIT.STOPPED };
  }
  const expired = staleLeases(q, now(), q.config.leaseMinutes);
  if (expired.length) {
    console.log(`queue: OWNERSHIP CONFLICT — expired lease(s) remain active: ${expired
      .map(t => t.id).join(', ')}. Do not reclaim or dispatch; resolve ownership explicitly.`);
    return { queue: q, blocked: EXIT.CONFLICT };
  }
  return { queue: q, blocked: null };
}

function cmdTick(q: Queue): number {
  const gate = dispatchGate(q);
  if (gate.blocked !== null) return gate.blocked;
  q = gate.queue;
  const t = nextActionable(q);
  if (!t) {
    const stuck = deadlocked(q);
    console.log(stuck.length
      ? `queue: IDLE — ${stuck.length} task(s) blocked by a failed dependency: ${stuck.map(x => x.id).join(', ')}`
      : 'queue: IDLE — no eligible tasks');
    save(q);
    return EXIT.IDLE;
  }
  if (t.status === 'pending') { q = beginTask(q, t.id, now(), t.owner); log(`begin ${t.id}`); }
  save(q);
  const current = q.tasks.find(x => x.id === t.id)!;
  console.log(`queue: working ${t.id}\n${taskBlock(current)}\n`
    + `When finished: node scripts/queue.ts done ${t.id}  (or fail ${t.id} "<reason>")`);
  return EXIT.DISPATCHED;
}

function cmdReady(q: Queue): number {
  const gate = dispatchGate(q);
  if (gate.blocked !== null) return gate.blocked;
  q = gate.queue;
  const r = readyTasks(q);
  if (!r.length) {
    console.log(`queue: none ready (maxParallel ${q.config.maxParallel}, `
      + `${q.tasks.filter(t => t.status === 'active').length} active)`);
    return EXIT.IDLE;
  }
  console.log(r.map(t => `${t.id} — ${t.title}`).join('\n'));
  return EXIT.DISPATCHED;
}

function cmdDone(q: Queue, id: string, skip: boolean): number {
  const t = q.tasks.find(x => x.id === id);
  if (!t) { console.error(`done: unknown task id ${id}`); return 1; }
  if (t.validate && !skip) {
    const r = unlocked(() => runValidate(t));
    q = load();
    const refreshed = q.tasks.find(task => task.id === id);
    if (!refreshed || !isDeepStrictEqual(t, refreshed)) {
      console.error(`done: ${id} changed during validation; inspect and retry`);
      return 1;
    }
    if (!r.ok) {
      const res = recordFailure(q, id, `validation failed: ${r.tail}`, q.config.maxFailures, now());
      save(res.queue);
      log(`validate-fail ${id} (${res.failures}/${q.config.maxFailures})`);
      console.log(`✗ validation failed for ${id} → ${res.terminal ? 'failed' : 'retry'} (${r.tail})`);
      return 1;
    }
  }
  // Complete the task, then archive it out of the live queue right away — plus any
  // earlier done task this completion just freed (one whose last unfinished
  // dependent was this one). A done task still depended on by unfinished work is
  // kept until that work finishes, so dependency resolution never breaks.
  let dq = markDone(q, id, now());
  const sweep = archivableDone(dq);
  if (sweep.length) {
    appendArchive(sweep);
    for (const s of sweep) dq = removeTask(dq, s.id);
  }
  save(dq);
  const archivedSelf = sweep.some(s => s.id === id);
  log(`done ${id}${sweep.length ? ` → archived ${sweep.map(s => s.id).join(', ')}` : ''}`);
  console.log(`✓ ${id} done${t.validate && !skip ? ' (validation passed)' : ''}`
    + (archivedSelf ? ' → archived' : ' (kept: still a dependency)'));
  return 0;
}

function cmdConfig(q: Queue, key: string, val: string): number {
  if ((TEXT_CONFIG_KEYS as readonly string[]).includes(key)) save(setConfig(q, { [key]: val }));
  else if ((NUMERIC_CONFIG_KEYS as readonly string[]).includes(key)) save(setConfig(q, { [key]: Number(val) }));
  else {
    console.error(`config: unknown key ${key} `
      + `(${[...NUMERIC_CONFIG_KEYS, ...TEXT_CONFIG_KEYS].join('|')})`);
    return 1;
  }
  console.log(`config ${key} = ${val}`);
  return 0;
}

function cmdArchive(q: Queue): number {
  const { queue, swept } = sweepFinished(q);
  if (!swept.length) { console.log('archive: nothing to sweep'); return 0; }
  appendArchive(swept);
  save(queue);
  log(`archived ${swept.length} task(s)`);
  console.log(`archived ${swept.length} task(s) → ${sidecar('archive.md')}`);
  return 0;
}


/**
 * The drain signal as a pollable command for a Monitor: prints the DRAIN-WANTED
 * marker and exits 0 when a running queue has eligible work and no active driver;
 * prints nothing and exits IDLE otherwise. A Monitor that polls this emits an event
 * ONLY when a drain is genuinely wanted — so it never fires on an empty/idle queue,
 * yet re-wakes the loop the moment a later `add` makes work drainable.
 */
function cmdSignal(q: Queue): number {
  const sig = drainSignal(q);
  if (!sig) return EXIT.IDLE;
  console.log(sig);
  return EXIT.DISPATCHED;
}

// ---------------------------------------------------------------- worktrees

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

function cmdWorktree(q: Queue, sub: string, id: string): number {
  if (sub === 'add') return cmdWorktreeAdd(q, id);
  if (sub === 'remove' || sub === 'rm') return cmdWorktreeRemove(q, id);
  if (sub === 'list') { console.log(git('worktree list')); return 0; }
  console.error('usage: queue worktree add|remove|list <id>');
  return 1;
}

function cmdLoop(q: Queue): number {
  const paused = q.config.status === 'stopped' && q.config.resumeAt !== '';
  if (paused) {
    console.log(`/loop ${q.config.pausePoll} queue is paused for a usage window: run `
      + '`node scripts/queue.ts tick` — it auto-resumes once the window reopens, then '
      + 'switch back to the normal interval');
    return 0;
  }
  const drain = q.config.maxParallel > 1
    ? 'run `node scripts/queue.ts ready` and dispatch each returned task in its own worktree, then done/fail each'
    : 'run `node scripts/queue.ts tick` and do the task it prints, then `done <id>` or `fail <id>`';
  // Arm a Monitor that POLLS `queue signal` (not the file mtime): it emits an event
  // only when a running queue has eligible work and no active driver, so it never
  // fires on an empty/idle queue, yet re-wakes the loop the moment a later add makes
  // work drainable. Each finished task auto-archives out of the queue, so a drain
  // ends with the queue truly empty. On idle (tick exits 3) TERMINATE the loop
  // (ScheduleWakeup stop:true) — the signal-Monitor is the standing driver. Exit 5
  // (operator stop) always ends the loop; exit 4 slow-polls a usage window.
  const signalPoll = `arm a Monitor whose command polls the drain signal — e.g. `
    + `\`while true; do node scripts/queue.ts signal; sleep ${q.config.idlePoll}; done\` — `
    + `it prints a line ONLY when work is drainable, so it never fires on an empty queue`;
  console.log(`/loop ${q.config.idlePoll} drain the work queue: FIRST ${signalPoll}; `
    + `ONE orchestrator owns this session; other sessions and user-launched agent CLIs are `
    + `independent and must never be stopped, reclaimed, interrupted, or signalled. Queue lease `
    + `expiry is metadata only and grants no process authority. `
    + `THEN repeatedly ${drain} — keep going while tick/ready exits 0 (each completed task `
    + `auto-archives out of the queue). On exit 3 (idle/drained) TERMINATE the loop with `
    + `ScheduleWakeup stop:true; the signal-Monitor re-wakes the loop only when a later add `
    + `makes work drainable, so the queue can't stall and no loop fires on an empty queue. `
    + `Only if you could NOT arm a Monitor, fall back to re-arming the ${q.config.idlePoll} `
    + `heartbeat (it must poll, so it may wake on an empty queue). Exit 5 (operator stop) `
    + `always stops the loop; exit 4 slow-polls at ${q.config.pausePoll}. `
    + `Exit 6 (ownership conflict) stops dispatch: report the conflict and leave claims, `
    + `processes, and worktrees untouched until ownership is resolved. `
    + `Cadence: busy → continue immediately · idle → stop:true (signal-Monitor re-wakes on new `
    + `work; ${q.config.idlePoll} heartbeat only if unmonitored) · paused → ${q.config.pausePoll}.`);
  return 0;
}

// ---------------------------------------------------------------- dispatch

function main(argv: string[]): number {
  const stdinItems = argv[0] === 'add-many' && parse(argv.slice(1)).positionals.length === 0
    ? readStdin() : undefined;
  return withLock(() => dispatch(argv, stdinItems));
}

function dispatch(argv: string[], stdinItems?: string[]): number {
  const [cmd = 'list', ...rest] = argv;
  const f = parse(rest);
  const id = f.positionals[0];
  let q = load();
  const needId = (): boolean => Boolean(id && q.tasks.some(t => t.id === id));

  switch (cmd) {
    case 'list': case 'status': console.log(renderModel(q)); return 0;
    case 'show':
      if (!needId()) { console.error('show: unknown task id'); return 1; }
      console.log(showTask(q.tasks.find(t => t.id === id)!)); return 0;

    case 'add': {
      const title = f.positionals.join(' ').trim();
      if (!title) { console.error('usage: queue add "<title>" [flags]'); return 1; }
      q = addTask(q, title, { top: f.bools.has('top'), ...taskOverrides(f) });
      save(q); log(`add ${title}`);
      const t = q.tasks[f.bools.has('top') ? 0 : q.tasks.length - 1];
      console.log(`added ${t.id}${t.mode === 'chain' ? ' (chain)' : ''} — ${title}${drainKick(q)}`); return 0;
    }
    case 'add-many': {
      const raw = f.positionals.length ? f.positionals : stdinItems ?? [];
      const items = raw.map(cleanItem).filter(Boolean);
      if (!items.length) { console.error('add-many: no items (pass args or pipe lines on stdin)'); return 1; }
      q = addMany(q, items, { top: f.bools.has('top') });
      save(q); log(`add-many ${items.length}`);
      console.log(`added ${items.length} task(s); ${q.tasks.length} total${drainKick(q)}`); return 0;
    }
    case 'set': {
      const [, field, ...v] = f.positionals;
      if (!needId() || !field) { console.error('usage: queue set <id> <field> <value>'); return 1; }
      if (!(SPEC_FLAGS as readonly string[]).includes(field) || (field === 'title' && !v.join(' ').trim())) {
        console.error('queue set: unsupported field or empty title'); return 1;
      }
      q = setField(q, id, taskOverrides(parse([`--${field}`, v.join(' ')])));
      save(q);
      console.log(`set ${id}.${field}${drainKick(q)}`); return 0;
    }

    case 'next': {
      const t = nextActionable(q);
      console.log(q.config.status === 'stopped' ? 'queue: STOPPED'
        : t ? `next: ${t.id} — ${t.title}` : 'queue: IDLE'); return 0;
    }
    case 'ready': return cmdReady(q);
    case 'tick': return cmdTick(q);
    case 'signal': return cmdSignal(q);

    case 'claim': {
      if (!needId()) { console.error('claim: unknown task id'); return 1; }
      const t = q.tasks.find(x => x.id === id)!;
      if (t.status !== 'pending') { console.log(`claim: ${id} is ${t.status}, not claimable`); return 1; }
      if (t.held) { console.log(`claim: ${id} is held — unhold it first`); return 1; }
      const worker = f.flags.get('worker') ?? `worker-${process.pid}`;
      save(beginTask(q, id, now(), worker)); log(`claim ${id} by ${worker}`);
      console.log(`claimed ${id} for ${worker}\n${taskBlock({ ...t, owner: worker })}`); return 0;
    }
    case 'begin':
      if (!needId()) { console.error('begin: unknown task id'); return 1; }
      save(beginTask(q, id, now(), q.tasks.find(t => t.id === id)!.owner));
      console.log(`${id} → active`); return 0;
    case 'done': return cmdDone(q, id, f.bools.has('skip-validate'));
    case 'fail': {
      if (!needId()) { console.error('fail: unknown task id'); return 1; }
      const reason = f.positionals.slice(1).join(' ') || null;
      const r = recordFailure(q, id, reason, q.config.maxFailures, now());
      save(r.queue); log(`fail ${id} (${r.failures}/${q.config.maxFailures})${reason ? ': ' + reason : ''}`);
      console.log(`${id} → ${r.terminal ? 'failed (terminal)' : `retry ${r.failures}/${q.config.maxFailures}`}`);
      return 0;
    }

    case 'top': case 'prioritize':
      if (!needId()) { console.error('top: unknown task id'); return 1; }
      q = moveToTop(q, id); save(q);
      console.log(`${id} moved to top${drainKick(q)}`); return 0;
    case 'move': {
      const pos = Number(f.positionals[1]);
      if (!needId() || !Number.isInteger(pos) || pos < 1) {
        console.error('usage: queue move <id> <pos>  (1-based, as numbered in `queue list`)'); return 1;
      }
      q = moveTask(q, id, pos - 1); save(q); log(`move ${id} → ${pos}`);
      console.log(`${id} moved to position ${pos}${drainKick(q)}`); return 0;
    }
    case 'hold':
      if (!needId()) { console.error('hold: unknown task id'); return 1; }
      q = holdTask(q, id, true); save(q); log(`hold ${id}`);
      console.log(`${id} held (parked — the drain skips it until unhold)`); return 0;
    case 'unhold':
      if (!needId()) { console.error('unhold: unknown task id'); return 1; }
      q = holdTask(q, id, false); save(q); log(`unhold ${id}`);
      console.log(`${id} unheld${drainKick(q)}`); return 0;
    case 'requeue': {
      if (!needId()) { console.error('requeue: unknown task id'); return 1; }
      const before = q.tasks.find(t => t.id === id)!;
      if (before.status !== 'failed' && before.failures === 0) {
        console.log(`requeue: ${id} is ${before.status} with no failures — nothing to revive`); return 0;
      }
      q = requeueTask(q, id); save(q); log(`requeue ${id}`);
      console.log(`${id} requeued (pending, failures cleared)${drainKick(q)}`); return 0;
    }
    case 'remove': case 'rm':
      if (!needId()) { console.error('remove: unknown task id'); return 1; }
      save(removeTask(q, id)); log(`remove ${id}`); console.log(`removed ${id}`); return 0;

    case 'start':
      q = setConfig(q, { status: 'running', resumeAt: '' }); save(q);
      log('start'); console.log(`queue: running${drainKick(q)}`); return 0;
    case 'stop':
      save(setConfig(q, { status: 'stopped', resumeAt: '' }));
      log('stop'); console.log('queue: stopped'); return 0;
    case 'pause': {
      let resumeAt = f.flags.get('until') ?? '';
      if (!resumeAt && f.flags.has('minutes')) {
        resumeAt = new Date(Date.now() + Number(f.flags.get('minutes')) * MS_PER_MIN).toISOString();
      }
      if (!resumeAt) { console.error('usage: queue pause --until <iso> | --minutes <n>'); return 1; }
      save(pauseUntil(q, resumeAt)); log(`pause until ${resumeAt}`);
      console.log(`queue: paused until ${resumeAt} (auto-resumes after)`); return 0;
    }
    case 'interval':
      if (!id) { console.error('usage: queue interval <duration>'); return 1; }
      save(setConfig(q, { interval: id })); console.log(`interval: ${id}`); return 0;
    case 'config': return cmdConfig(q, f.positionals[0], f.positionals.slice(1).join(' '));
    case 'gate': return cmdGate(q, f.positionals[0] ?? '', f.flags.get('only') ?? '', f.bools.has('dry-run'));
    case 'ungate': return cmdUngate(q, f.positionals[0] ?? '', f.bools.has('keep-gate'), f.bools.has('dry-run'));
    case 'archive': return cmdArchive(q);
    case 'loop': return cmdLoop(q);
    case 'worktree': case 'wt': return cmdWorktree(q, f.positionals[0] ?? '', f.positionals[1] ?? '');
    case 'lane': return cmdLane(q, f.positionals[0] ?? '', f.positionals[1] ?? '', f);

    default:
      console.error(`unknown command: ${cmd}\ncommands: list show add add-many set next ready tick `
        + `signal claim begin done fail top move hold unhold requeue remove start stop pause interval config `
        + `gate ungate archive loop worktree lane`);
      return 1;
  }
}

function readStdin(): string[] {
  try { return readFileSync(0, 'utf8').split('\n'); } catch { return []; }
}
function cleanItem(line: string): string {
  return line.replace(/^\s*[-*]\s*(\[[ >xX!]?\]\s*)?/, '').trim();
}


if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
