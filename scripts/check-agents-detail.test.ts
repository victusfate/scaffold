import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anchor, check } from './check-agents-detail.ts';

assert.equal(anchor('Veracity — "done" means reachable, not just built'), 'veracity--done-means-reachable-not-just-built');
assert.equal(anchor("What This Doesn't Apply To"), 'what-this-doesnt-apply-to');

const archive = '## Session Start\n\ntext\n\n## PR Workflow\n\ntext\n';
const both = 'see [x](docs/agents-detail.md#session-start) and [y](docs/agents-detail.md#pr-workflow).';
assert.deepEqual(check(both, archive), []);
assert.match(check('see [x](docs/agents-detail.md#session-start).', archive)[0], /pr-workflow is archived but no AGENTS\.md section links to it/);
assert.match(check(both + ' [z](docs/agents-detail.md#gone)', archive)[0], /links docs\/agents-detail\.md#gone, which has no matching section/);
assert.match(check(both + 'x'.repeat(200), archive, 100)[0], /over the 100-byte limit/);
// Scaffold's own AGENTS.md stays under 16 KB so consumers can add sections and stay under 24 KB.
assert.ok(Buffer.byteLength(readFileSync('AGENTS.md', 'utf8')) <= 16000, 'scaffold AGENTS.md must stay under 16,000 bytes');
console.log('check-agents-detail.test: ok');
