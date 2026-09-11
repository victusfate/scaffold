#!/usr/bin/env node
// Tests for scripts/queue-console.ts — the queue console's pure core
// (ConsoleState shaping + applyOp dispatch) and, in later slices, its
// loopback HTTP server and page template.

import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { parseQueue } from './queue-model.ts';
import { consoleState, applyOp, startServer, type Op } from './queue-console.ts';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.error(`  pass  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const SAMPLE = `# Work Queue

<!-- queue:config
status: running
interval: 6m
maxParallel: 2
-->

- [ ] task-001 — Ship the widget
  - mode: chain
  - validate: npm test
- [ ] task-002 — Blocked child
  - deps: task-009
- [!] task-003 — Broken thing
  - failures: 3
  - note: needs-spec: which db?
- [ ] task-004 — Deadlocked child
  - deps: task-003
`;

// ---- consoleState: derived truth the page renders ----
{
  const s = consoleState(parseQueue(SAMPLE));
  assert('state passes config through', s.config.interval === '6m' && s.config.maxParallel === 2);
  assert('state keeps priority order',
    s.tasks.map(t => t.id).join(',') === 'task-001,task-002,task-003,task-004');
  assert('eligible pending flagged', s.tasks[0].eligible === true);
  assert('dep-blocked not eligible', s.tasks[1].eligible === false && s.tasks[1].deadlocked === false);
  assert('failed task not eligible', s.tasks[2].eligible === false);
  assert('child of failed dep deadlocked', s.tasks[3].deadlocked === true);
  assert('drain marker present when drainable', s.drain !== null && s.drain.includes('DRAIN-WANTED'));
  assert('drain null when stopped',
    consoleState(parseQueue(SAMPLE.replace('status: running', 'status: stopped'))).drain === null);
  assert('task fields survive shaping', s.tasks[2].note === 'needs-spec: which db?');
}

// ---- applyOp: happy paths ----
{
  const q = parseQueue(SAMPLE);
  const ok = (op: Op) => {
    const r = applyOp(q, op);
    if (!r.ok) assert(`op ${op.op} accepted`, false, r.error);
    return r.ok ? r : { queue: q, archived: [] };
  };

  const added = ok({ op: 'add', title: 'New task', fields: { mode: 'chain', deps: 'task-001', accept: 'it works' } });
  const last = added.queue.tasks[added.queue.tasks.length - 1];
  assert('add appends with fields', last.title === 'New task' && last.mode === 'chain'
    && last.dependsOn.join(',') === 'task-001' && last.accept === 'it works');
  assert('add assigns a fresh id', last.id === 'task-005');
  assert('add --top prepends', ok({ op: 'add', title: 'Urgent', top: true }).queue.tasks[0].title === 'Urgent');

  const set = ok({ op: 'set', id: 'task-001', fields: { title: 'Ship the gadget', files: 'a.ts, b.ts', validate: '' } });
  const t1 = set.queue.tasks[0];
  assert('set patches title and lists', t1.title === 'Ship the gadget' && t1.files.join(',') === 'a.ts,b.ts');
  assert('set empty string clears a field', t1.validate === null);

  assert('remove drops the task', ok({ op: 'remove', id: 'task-002' }).queue.tasks.length === 3);
  assert('top moves to head', ok({ op: 'top', id: 'task-004' }).queue.tasks[0].id === 'task-004');
  assert('move reorders to index', ok({ op: 'move', id: 'task-004', to: 1 }).queue.tasks[1].id === 'task-004');
  const requeued = ok({ op: 'requeue', id: 'task-003' }).queue.tasks[2];
  assert('requeue revives failed', requeued.status === 'pending' && requeued.failures === 0);

  assert('stop stops', ok({ op: 'stop' }).queue.config.status === 'stopped');
  const stopped = applyOp(q, { op: 'stop' });
  const restarted = stopped.ok ? applyOp(stopped.queue, { op: 'start' }) : stopped;
  assert('start resumes', restarted.ok && restarted.queue.config.status === 'running');
  assert('config sets a string key', ok({ op: 'config', key: 'interval', value: '9m' }).queue.config.interval === '9m');
  assert('config sets a numeric key', ok({ op: 'config', key: 'maxParallel', value: '4' }).queue.config.maxParallel === 4);
}

// ---- applyOp: reassign recomputes dispatch without mutating ----
{
  const q = parseQueue(SAMPLE);
  const before = q.tasks.map(t => t.id).join(',');
  const r = applyOp(q, { op: 'reassign' });
  assert('reassign accepted', r.ok);
  assert('reassign touches no task', r.ok && r.queue.tasks.map(t => t.id).join(',') === before);
  assert('reassign touches no config', r.ok && r.queue.config.maxParallel === 2);
  const empty = applyOp(parseQueue(''), { op: 'reassign' });
  assert('reassign on empty queue is ok', empty.ok);
}

// ---- applyOp: stop-lane validates without mutating ----
{
  const q = parseQueue(SAMPLE);
  const bad = applyOp(q, { op: 'stop-lane', id: 'task-999' });
  assert('stop-lane unknown id rejected', !bad.ok);
  const r = applyOp(q, { op: 'stop-lane', id: 'task-001' });
  assert('stop-lane accepted', r.ok);
  assert('stop-lane touches no task', r.ok
    && r.queue.tasks.map(t => t.id).join(',') === q.tasks.map(t => t.id).join(','));
}

// ---- applyOp: claim-lane / release move tasks between queue and lanes ----
{
  const q = parseQueue(SAMPLE); // maxParallel 2, nothing active
  const badClaim = applyOp(q, { op: 'claim-lane', id: 'task-999' });
  assert('claim-lane unknown id rejected', !badClaim.ok);
  const badState = applyOp(q, { op: 'claim-lane', id: 'task-003' });
  assert('claim-lane on failed rejected', !badState.ok);
  const claimed = applyOp(q, { op: 'claim-lane', id: 'task-001' }, '2026-09-11T15:00:00.000Z');
  const c1 = claimed.ok ? claimed.queue.tasks[0] : null;
  assert('claim-lane activates with first free slot',
    claimed.ok && c1 !== null && c1.status === 'active' && c1.owner === 'lane-1'
    && c1.startedAt === '2026-09-11T15:00:00.000Z');
  const second = claimed.ok
    ? applyOp(claimed.queue, { op: 'claim-lane', id: 'task-002' }, '2026-09-11T15:01:00.000Z') : claimed;
  assert('claim-lane takes the next free slot',
    second.ok && second.queue.tasks[1].owner === 'lane-2');
  const full = second.ok ? applyOp(second.queue, { op: 'claim-lane', id: 'task-004' }) : second;
  assert('claim-lane at capacity rejected', !full.ok);

  const badRelease = applyOp(q, { op: 'release', id: 'task-999' });
  assert('release unknown id rejected', !badRelease.ok);
  assert('release on pending rejected', !applyOp(q, { op: 'release', id: 'task-001' }).ok);
  const freed = claimed.ok ? applyOp(claimed.queue, { op: 'release', id: 'task-001' }, '2026-09-11T15:25:00.000Z') : claimed;
  const f1 = freed.ok ? freed.queue.tasks[0] : null;
  assert('release returns the lane to pending',
    freed.ok && f1 !== null && f1.status === 'pending' && f1.owner === null && f1.startedAt === null);
  assert('release banks the session (25m)', freed.ok && f1 !== null && f1.elapsedSecs === 1500);
  assert('release keeps position',
    freed.ok && freed.queue.tasks.map(t => t.id).join(',') === 'task-001,task-002,task-003,task-004');
}

// ---- applyOp: hold / mark-done / force-fail / reopen (every column a target) ----
{
  const q = parseQueue(SAMPLE);
  const ids = (r: { ok: boolean; queue?: { tasks: { id: string }[] } }): string =>
    r.ok && r.queue ? r.queue.tasks.map(t => t.id).join(',') : 'ERR';

  assert('hold unknown id rejected', !applyOp(q, { op: 'hold', id: 'task-999' }).ok);
  const held = applyOp(q, { op: 'hold', id: 'task-001' });
  assert('hold parks pending', held.ok && held.queue.tasks[0].held === true);
  assert('hold keeps order', ids(held) === 'task-001,task-002,task-003,task-004');
  const unheld = held.ok ? applyOp(held.queue, { op: 'unhold', id: 'task-001' }) : held;
  assert('unhold clears the flag', unheld.ok && unheld.queue.tasks[0].held === false);
  assert('unhold unknown id rejected', !applyOp(q, { op: 'unhold', id: 'task-999' }).ok);
  assert('claim-lane on held rejected', (() => {
    const h = applyOp(q, { op: 'hold', id: 'task-002' });
    return h.ok && !applyOp(h.queue, { op: 'claim-lane', id: 'task-002' }).ok;
  })());

  const done = applyOp(q, { op: 'mark-done', id: 'task-001' });
  assert('mark-done completes without validation',
    done.ok && !done.queue.tasks.some(t => t.id === 'task-001'));
  assert('mark-done archives the swept task',
    done.ok && done.archived.map(t => t.id).join(',') === 'task-001');
  assert('mark-done on done is an idempotent success', (() => {
    const dq = parseQueue('- [x] task-001 — base\n- [ ] task-002 — child\n  - deps: task-001\n');
    const r = applyOp(dq, { op: 'mark-done', id: 'task-001' });
    return r.ok && r.queue.tasks.length === 2 && r.archived.length === 0;
  })());
  assert('mark-done unknown id rejected', !applyOp(q, { op: 'mark-done', id: 'task-999' }).ok);

  const failed = applyOp(q, { op: 'force-fail', id: 'task-002' });
  const f2 = failed.ok ? failed.queue.tasks.find(t => t.id === 'task-002')! : null;
  assert('force-fail goes terminal with operator note',
    failed.ok && f2 !== null && f2.status === 'failed' && (f2.note ?? '').includes('operator'));
  const noted = applyOp(q, { op: 'force-fail', id: 'task-002', note: 'wrong direction' });
  assert('force-fail honors a custom note',
    noted.ok && noted.queue.tasks.find(t => t.id === 'task-002')!.note === 'wrong direction');
  assert('force-fail on failed is a no-op success',
    applyOp(parseQueue('- [!] task-001 — x\n'), { op: 'force-fail', id: 'task-001' }).ok);

  const open = applyOp(parseQueue('- [x] task-001 — old\n- [ ] task-002 — live\n'),
    { op: 'reopen', id: 'task-001' });
  assert('reopen done → pending', open.ok && open.queue.tasks[0].status === 'pending');
  assert('reopen on pending rejected', !applyOp(q, { op: 'reopen', id: 'task-001' }).ok);
  assert('reopen unknown id rejected', !applyOp(q, { op: 'reopen', id: 'task-999' }).ok);
}

// ---- applyOp: archive returns the swept tasks for the caller to persist ----
{
  const q = parseQueue('- [x] task-001 — done\n- [!] task-002 — dead\n- [ ] task-003 — live\n');
  const r = applyOp(q, { op: 'archive' });
  assert('archive sweeps done+failed', r.ok && r.queue.tasks.length === 1 && r.queue.tasks[0].id === 'task-003');
  assert('archive reports swept tasks', r.ok && r.archived.map(t => t.id).join(',') === 'task-001,task-002');
  const empty = applyOp(parseQueue('- [ ] task-001 — live\n'), { op: 'archive' });
  assert('archive with nothing to sweep is ok+empty', empty.ok && empty.archived.length === 0);

  // the DAG guard applies to archive too: a done task with an unfinished
  // dependent stays, or the dependent would be stranded forever
  const chained = parseQueue('- [x] task-001 — base\n- [ ] task-002 — child\n  - deps: task-001\n');
  const kept = applyOp(chained, { op: 'archive' });
  assert('archive keeps a depended-on done task',
    kept.ok && kept.queue.tasks.length === 2 && kept.archived.length === 0);
}

// ---- applyOp: rejections leave the queue untouched ----
{
  const q = parseQueue(SAMPLE);
  const err = (label: string, op: unknown): void => {
    const r = applyOp(q, op as Op);
    assert(label, !r.ok && typeof (r as { error: string }).error === 'string');
  };
  err('unknown op rejected', { op: 'done', id: 'task-001' });
  err('execution verbs are not ops', { op: 'fail', id: 'task-001' });
  err('missing op rejected', {});
  err('add without title rejected', { op: 'add', title: '  ' });
  err('set unknown id rejected', { op: 'set', id: 'task-999', fields: { title: 'x' } });
  err('remove missing id rejected', { op: 'remove' });
  err('move without integer to rejected', { op: 'move', id: 'task-001', to: 'up' });
  err('move negative to rejected', { op: 'move', id: 'task-001', to: -1 });
  err('config unknown key rejected', { op: 'config', key: 'status', value: 'stopped' });
  err('config bad number rejected', { op: 'config', key: 'maxParallel', value: 'lots' });
  err('set with unknown field rejected', { op: 'set', id: 'task-001', fields: { owner: 'me' } });
}

// ---- applyOp: dependency integrity — the interface guards the DAG ----
{
  const q = parseQueue('- [ ] task-001 — base\n- [ ] task-002 — mid\n  - deps: task-001\n'
    + '- [ ] task-003 — leaf\n  - deps: task-002\n- [x] task-004 — old\n');
  const err = (label: string, op: unknown): void => {
    const r = applyOp(q, op as Op);
    assert(label, !r.ok && typeof (r as { error: string }).error === 'string');
  };

  err('deps to a nonexistent task rejected', { op: 'set', id: 'task-003', fields: { deps: 'task-999' } });
  err('self-dependency rejected', { op: 'set', id: 'task-001', fields: { deps: 'task-001' } });
  err('dependency cycle rejected', { op: 'set', id: 'task-001', fields: { deps: 'task-003' } });
  err('add with unknown dep rejected', { op: 'add', title: 'x', fields: { deps: 'task-999' } });
  err('remove of a depended-on task rejected', { op: 'remove', id: 'task-001' });

  const leaf = applyOp(q, { op: 'remove', id: 'task-003' });
  assert('remove of a leaf allowed', leaf.ok);
  const done = applyOp(q, { op: 'remove', id: 'task-004' });
  assert('remove of a done task nothing depends on allowed', done.ok);
  const cleared = applyOp(q, { op: 'set', id: 'task-002', fields: { deps: '' } });
  assert('clearing deps allowed', cleared.ok && cleared.queue.tasks[1].dependsOn.length === 0);
  const valid = applyOp(q, { op: 'set', id: 'task-003', fields: { deps: 'task-001, task-002' } });
  assert('valid multi-dep accepted', valid.ok && valid.queue.tasks[2].dependsOn.join(',') === 'task-001,task-002');
}

// ---- template: the page's contract with the server and the design ----
{
  const html = readFileSync(join(import.meta.dirname, 'queue-console.template.html'), 'utf8');
  const has = (label: string, needle: string): void =>
    assert(label, html.includes(needle), `missing ${needle}`);

  has('page posts to the op endpoint', '/api/op');
  has('page reads lanes from the api', '/api/lanes');
  has('page subscribes to SSE', '/events');
  has('task list mount point', 'id="tasks"');
  has('add form mount point', 'id="add"');
  has('status header mount point', 'id="status"');
  has('changed-on-disk banner mount point', 'id="stale"');
  has('free-lane drop placeholder', 'drop a task here');
  has('held chip', '>held<');
  has('elapsed chip', '⏱');
  has('elapsed live session', 'live session');
  has('dark default with toggle', 'data-theme');
  has('theme toggle button', 'id="theme"');
  has('theme persists', 'qc-theme');
  has('empty-state click-to-move hint', 'click a card, then a column');
  has('click-to-move fallback', 'armedId');
  has('armed card highlight', 'selected');
  has('escape disarms', 'Escape');
  has('dispatch plan mount point', 'id="plan"');
  has('error surface mount point', 'id="error"');
  has('kanban Queued column', '["Queued"');
  has('kanban Blocked column', '["Blocked"');
  has('kanban In Progress column', '["In Progress"');
  has('kanban Done column', '["Done"');
  has('kanban Failed column', '["Failed"');
  has('columns render from ConsoleState', 'S.tasks.filter');
  for (const op of ['"add"', '"set"', '"remove"', '"move"', '"top"', '"requeue"', '"start"', '"stop"', '"config"', '"archive"', '"reassign"', '"stop-lane"', '"claim-lane"', '"release"', '"hold"', '"unhold"', '"mark-done"', '"force-fail"', '"reopen"']) {
    has(`page wires op ${op}`, `op: ${op}`);
  }
  has('rows are draggable', 'draggable');
  has('drag carries data (Firefox)', 'setData');
  has('dragend fallback', '"dragend"');
  has('whole card body grabs', 'cursor: grab');
  has('controls keep their clicks', 'button, input, select, textarea, a');
  assert('page has no execution verbs',
    !html.includes("op: 'done'") && !html.includes("op: 'fail'") && !html.includes("op: 'claim'"));
  assert('page loads no external assets',
    !/(?:src|href)\s*=\s*["']https?:\/\//.test(html), 'external src/href found');
}

// ---- server: loopback HTTP round-trips against a temp queue file ----
{
  const dir = mkdtempSync(join(tmpdir(), 'queue-console-'));
  const file = join(dir, 'queue.md');
  writeFileSync(file, '- [ ] task-001 — first\n- [x] task-002 — finished\n');
  process.env.QUEUE_FILE = file;

  const server = startServer(0);
  await new Promise<void>(res => server.on('listening', res));
  const addr = server.address() as { address: string; port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  assert('server binds loopback only', addr.address === '127.0.0.1', addr.address);

  const page = await fetch(`${base}/`);
  assert('GET / serves the console page', page.status === 200
    && (page.headers.get('content-type') ?? '').includes('text/html'));

  const state = await (await fetch(`${base}/api/queue`)).json() as { tasks: { id: string }[] };
  assert('GET /api/queue reflects the file', state.tasks.map(t => t.id).join(',') === 'task-001,task-002');

  const post = (body: unknown): Promise<Response> => fetch(`${base}/api/op`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  const added = await post({ op: 'add', title: 'From the page', top: true });
  const addedState = await added.json() as { tasks: { title: string }[] };
  assert('POST op returns fresh state', added.status === 200 && addedState.tasks[0].title === 'From the page');
  assert('POST op mutates the file on disk', readFileSync(file, 'utf8').includes('From the page'));

  const before = readFileSync(file, 'utf8');
  const bad = await post({ op: 'done', id: 'task-001' });
  assert('execution verb → 400', bad.status === 400);
  const badBody = await bad.json() as { error?: string };
  assert('400 carries the reason', typeof badBody.error === 'string');
  assert('rejected op leaves the file untouched', readFileSync(file, 'utf8') === before);
  assert('malformed JSON → 400', (await fetch(`${base}/api/op`, { method: 'POST', body: '{nope' })).status === 400);
  assert('unknown route → 404', (await fetch(`${base}/nope`)).status === 404);

  const swept = await post({ op: 'archive' });
  assert('archive op sweeps the file', swept.status === 200 && !readFileSync(file, 'utf8').includes('task-002'));
  assert('archive op persists the sidecar', existsSync(join(dir, 'archive.md'))
    && readFileSync(join(dir, 'archive.md'), 'utf8').includes('task-002'));

  const lanes = await (await fetch(`${base}/api/lanes`)).json() as { lanes: { id: string }[] };
  assert('GET /api/lanes reflects sidecars', Array.isArray(lanes.lanes));

  const events = await fetch(`${base}/events`);
  assert('SSE endpoint speaks event-stream',
    (events.headers.get('content-type') ?? '').includes('text/event-stream'));
  const reader = events.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert('SSE greets the client', first.includes(': connected'));

  // a request whose Host is not loopback is a DNS-rebinding attempt → 403 on
  // every route (fetch forbids overriding Host, so use a raw request)
  const rebound = await new Promise<number>(resolve => {
    http.get({ host: '127.0.0.1', port: addr.port, path: '/api/queue',
      headers: { host: 'attacker.example' } }, r => resolve(r.statusCode ?? 0));
  });
  assert('non-loopback Host → 403', rebound === 403, String(rebound));

  // a JSON content-type is required — this is what forces cross-origin
  // browsers into a preflight the server never answers
  const plain = await fetch(`${base}/api/op`, {
    method: 'POST', headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ op: 'stop' }),
  });
  assert('non-JSON content-type → 400', plain.status === 400);

  // the essence must be json — `text/plain; application/json` is essence
  // text/plain (CORS-safelisted, sent with NO preflight) and must be refused
  const smuggled = await fetch(`${base}/api/op`, {
    method: 'POST', headers: { 'content-type': 'text/plain; application/json' },
    body: JSON.stringify({ op: 'stop' }),
  });
  assert('safelisted-essence smuggling → 400', smuggled.status === 400);
  const charset = await fetch(`${base}/api/op`, {
    method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ op: 'config', key: 'idlePoll', value: '25m' }),
  });
  assert('json with charset suffix accepted', charset.status === 200);

  // close() must complete even with this SSE stream still open (it ends the
  // stream and detaches the file watcher) — a hang here fails the whole run
  const closed = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 3000);
    server.close(() => { clearTimeout(timer); resolve(true); });
  });
  assert('close completes with an open SSE client', closed);
  await reader.cancel().catch(() => {});
  delete process.env.QUEUE_FILE;
}

console.error(`\nqueue-console.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
