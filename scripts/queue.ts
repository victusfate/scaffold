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
//   node scripts/queue.ts tick                       # serial loop entry (reclaim→begin→print)
//   node scripts/queue.ts claim <id> [--worker w]    # atomic claim for a parallel worker
//   node scripts/queue.ts done <id> [--skip-validate]# run validate, then complete
//   node scripts/queue.ts fail <id> [reason...]      # record a failure (retries then terminal)
//   node scripts/queue.ts top <id> | remove <id>
//   node scripts/queue.ts start | stop               # run/pause the worker
//   node scripts/queue.ts interval 6m                # edit the wake interval
//   node scripts/queue.ts config <key> <value>       # maxFailures|leaseMinutes|maxParallel|integrationBranch
//   node scripts/queue.ts archive                    # sweep done/failed into archive.md
//   node scripts/queue.ts loop                       # print the /loop invocation for this queue
//
// add/set flags: --mode chain --slug <s> --deps a,b --files a,b --validate "<cmd>"
//   --accept "<criteria>" --top --worker <name>

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  parseQueue, serializeQueue, render as renderModel,
  addTask, addMany, setTaskStatus, setField, moveToTop, removeTask, setConfig,
  beginTask, markDone, recordFailure, reclaimStale,
  nextActionable, readyTasks, deadlocked,
  type Queue, type Task, type QueueConfig,
} from './queue-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_DIR = join(ROOT, '.agent', 'queue');

function queueFile(): string { return process.env.QUEUE_FILE ?? join(QUEUE_DIR, 'queue.md'); }
function sidecar(name: string): string { return join(dirname(queueFile()), name); }
function now(): string { return new Date().toISOString(); }

function load(): Queue {
  const p = queueFile();
  return existsSync(p) ? parseQueue(readFileSync(p, 'utf8')) : parseQueue('');
}
function save(q: Queue): void {
  const p = queueFile();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeQueue(q));
}
function log(msg: string): void {
  appendFileSync(sidecar('log.md'), `- ${now()} ${msg}\n`);
}

// ---------------------------------------------------------------- flags

interface Parsed { positionals: string[]; flags: Map<string, string>; bools: Set<string>; }

const VALUE_FLAGS = new Set(['mode', 'slug', 'deps', 'files', 'validate', 'accept', 'worker', 'note']);

function parse(rest: string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (VALUE_FLAGS.has(key)) flags.set(key, rest[++i] ?? '');
      else bools.add(key);
    } else positionals.push(a);
  }
  return { positionals, flags, bools };
}

function taskOverrides(f: Parsed): Partial<Task> {
  const o: Partial<Task> = {};
  if (f.flags.has('mode')) o.mode = f.flags.get('mode') === 'chain' ? 'chain' : 'direct';
  if (f.flags.has('slug')) o.slug = f.flags.get('slug') || null;
  if (f.flags.has('deps')) o.dependsOn = (f.flags.get('deps') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (f.flags.has('files')) o.files = (f.flags.get('files') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (f.flags.has('validate')) o.validate = f.flags.get('validate') || null;
  if (f.flags.has('accept')) o.accept = f.flags.get('accept') || null;
  return o;
}

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
  const rows: string[] = [`${t.id} [${t.status}] — ${t.title}`];
  const add = (k: string, v: string): void => { rows.push(`  ${k}: ${v}`); };
  add('mode', t.mode);
  if (t.slug) add('slug', t.slug);
  if (t.dependsOn.length) add('deps', t.dependsOn.join(', '));
  if (t.files.length) add('files', t.files.join(', '));
  if (t.validate) add('validate', t.validate);
  if (t.accept) add('accept', t.accept);
  if (t.failures) add('failures', String(t.failures));
  if (t.note) add('note', t.note);
  if (t.owner) add('owner', t.owner);
  if (t.branch) add('branch', t.branch);
  if (t.worktree) add('worktree', t.worktree);
  if (t.startedAt) add('started', t.startedAt);
  return rows.join('\n');
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

function cmdTick(q: Queue): number {
  if (q.config.status === 'stopped') { console.log('queue: STOPPED — run `queue start` to resume'); return 0; }
  const swept = reclaimStale(q, now(), q.config.leaseMinutes);
  if (swept.reclaimed.length) {
    for (const t of swept.reclaimed) log(`reclaimed ${t.id} (stale lease)`);
    q = swept.queue;
  }
  const t = nextActionable(q);
  if (!t) {
    const stuck = deadlocked(q);
    console.log(stuck.length
      ? `queue: IDLE — ${stuck.length} task(s) blocked by a failed dependency: ${stuck.map(x => x.id).join(', ')}`
      : 'queue: IDLE — no eligible tasks');
    save(q);
    return 0;
  }
  if (t.status === 'pending') { q = beginTask(q, t.id, now(), t.owner); log(`begin ${t.id}`); }
  save(q);
  const current = q.tasks.find(x => x.id === t.id)!;
  console.log(`queue: working ${t.id}\n${taskBlock(current)}\n`
    + `When finished: node scripts/queue.ts done ${t.id}  (or fail ${t.id} "<reason>")`);
  return 0;
}

function cmdDone(q: Queue, id: string, skip: boolean): number {
  const t = q.tasks.find(x => x.id === id);
  if (!t) { console.error(`done: unknown task id ${id}`); return 1; }
  if (t.validate && !skip) {
    const r = runValidate(t);
    if (!r.ok) {
      const res = recordFailure(q, id, `validation failed: ${r.tail}`, q.config.maxFailures);
      save(res.queue);
      log(`validate-fail ${id} (${res.failures}/${q.config.maxFailures})`);
      console.log(`✗ validation failed for ${id} → ${res.terminal ? 'failed' : 'retry'} (${r.tail})`);
      return 1;
    }
  }
  save(markDone(q, id));
  log(`done ${id}`);
  console.log(`✓ ${id} done${t.validate && !skip ? ' (validation passed)' : ''}`);
  return 0;
}

function cmdConfig(q: Queue, key: string, val: string): number {
  const numKeys: (keyof QueueConfig)[] = ['maxFailures', 'leaseMinutes', 'maxParallel'];
  if (key === 'integrationBranch') save(setConfig(q, { integrationBranch: val }));
  else if (numKeys.includes(key as keyof QueueConfig)) save(setConfig(q, { [key]: Number(val) } as Partial<QueueConfig>));
  else { console.error(`config: unknown key ${key} (maxFailures|leaseMinutes|maxParallel|integrationBranch)`); return 1; }
  console.log(`config ${key} = ${val}`);
  return 0;
}

function cmdArchive(q: Queue): number {
  const gone = q.tasks.filter(t => t.status === 'done' || t.status === 'failed');
  if (!gone.length) { console.log('archive: nothing to sweep'); return 0; }
  const block = `\n## Archived ${now()}\n\n`
    + gone.map(t => `- [${t.status === 'done' ? 'x' : '!'}] ${t.id} — ${t.title}`).join('\n') + '\n';
  appendFileSync(sidecar('archive.md'), block);
  save({ config: q.config, tasks: q.tasks.filter(t => t.status !== 'done' && t.status !== 'failed') });
  log(`archived ${gone.length} task(s)`);
  console.log(`archived ${gone.length} task(s) → ${sidecar('archive.md')}`);
  return 0;
}

function cmdLoop(q: Queue): number {
  const drain = q.config.maxParallel > 1
    ? `run \`node scripts/queue.ts ready\`, dispatch each returned task in its own worktree, then done/fail each`
    : `run \`node scripts/queue.ts tick\`, do the one task it prints, then \`done <id>\` or \`fail <id>\``;
  console.log(`/loop ${q.config.interval} drain the work queue: ${drain}`);
  return 0;
}

// ---------------------------------------------------------------- dispatch

function main(argv: string[]): number {
  const [cmd = 'list', ...rest] = argv;
  const f = parse(rest);
  const id = f.positionals[0];
  const needId = (): boolean => Boolean(id && load().tasks.some(t => t.id === id));
  let q = load();

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
      console.log(`added ${t.id}${t.mode === 'chain' ? ' (chain)' : ''} — ${title}`); return 0;
    }
    case 'add-many': {
      const raw = f.positionals.length ? f.positionals : readStdin();
      const items = raw.map(cleanItem).filter(Boolean);
      if (!items.length) { console.error('add-many: no items (pass args or pipe lines on stdin)'); return 1; }
      q = addMany(q, items, { top: f.bools.has('top') });
      save(q); log(`add-many ${items.length}`);
      console.log(`added ${items.length} task(s); ${q.tasks.length} total`); return 0;
    }
    case 'set': {
      const [, field, ...v] = f.positionals;
      if (!needId() || !field) { console.error('usage: queue set <id> <field> <value>'); return 1; }
      save(setField(q, id, taskOverrides(parse([`--${field}`, v.join(' ')]))));
      console.log(`set ${id}.${field}`); return 0;
    }

    case 'next': {
      const t = nextActionable(q);
      console.log(q.config.status === 'stopped' ? 'queue: STOPPED'
        : t ? `next: ${t.id} — ${t.title}` : 'queue: IDLE'); return 0;
    }
    case 'ready': {
      const r = readyTasks(q);
      console.log(r.length ? r.map(t => `${t.id} — ${t.title}`).join('\n')
        : `queue: none ready (maxParallel ${q.config.maxParallel}, `
          + `${q.tasks.filter(t => t.status === 'active').length} active)`);
      return 0;
    }
    case 'tick': return cmdTick(q);

    case 'claim': {
      if (!needId()) { console.error('claim: unknown task id'); return 1; }
      const t = q.tasks.find(x => x.id === id)!;
      if (t.status !== 'pending') { console.log(`claim: ${id} is ${t.status}, not claimable`); return 1; }
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
      const r = recordFailure(q, id, reason, q.config.maxFailures);
      save(r.queue); log(`fail ${id} (${r.failures}/${q.config.maxFailures})${reason ? ': ' + reason : ''}`);
      console.log(`${id} → ${r.terminal ? 'failed (terminal)' : `retry ${r.failures}/${q.config.maxFailures}`}`);
      return 0;
    }

    case 'top': case 'prioritize':
      if (!needId()) { console.error('top: unknown task id'); return 1; }
      save(moveToTop(q, id)); console.log(`${id} moved to top`); return 0;
    case 'remove': case 'rm':
      if (!needId()) { console.error('remove: unknown task id'); return 1; }
      save(removeTask(q, id)); log(`remove ${id}`); console.log(`removed ${id}`); return 0;

    case 'start': case 'stop':
      save(setConfig(q, { status: cmd === 'start' ? 'running' : 'stopped' }));
      log(cmd); console.log(`queue: ${cmd === 'start' ? 'running' : 'stopped'}`); return 0;
    case 'interval':
      if (!id) { console.error('usage: queue interval <duration>'); return 1; }
      save(setConfig(q, { interval: id })); console.log(`interval: ${id}`); return 0;
    case 'config': return cmdConfig(q, f.positionals[0], f.positionals.slice(1).join(' '));
    case 'archive': return cmdArchive(q);
    case 'loop': return cmdLoop(q);

    default:
      console.error(`unknown command: ${cmd}\ncommands: list show add add-many set next ready tick `
        + `claim begin done fail top remove start stop interval config archive loop`);
      return 1;
  }
}

function readStdin(): string[] {
  try { return readFileSync(0, 'utf8').split('\n'); } catch { return []; }
}
function cleanItem(line: string): string {
  return line.replace(/^\s*[-*]\s*(\[[ >xX!]?\]\s*)?/, '').trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
