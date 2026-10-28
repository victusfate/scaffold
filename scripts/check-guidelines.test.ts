import assert from 'node:assert/strict';
import { check, MIN_PARAGRAPH } from './check-guidelines.ts';

const para = (s: string) => s.padEnd(MIN_PARAGRAPH, '.');
const rule = para('Run the gate before every merge and read the real conclusions');

// A paragraph restated in two files has two homes; the second copy drifts.
assert.deepEqual(check(new Map([['a.md', rule], ['b.md', 'other']]), 1e6), []);
const dup = check(new Map([['a.md', rule], ['skills/b.md', `intro\n\n${rule}\n`]]), 1e6);
assert.equal(dup.length, 1);
assert.match(dup[0], /duplicated in a\.md, skills\/b\.md/);
// Whitespace and line wrapping do not hide a copy.
assert.equal(check(new Map([['a.md', rule], ['b.md', rule.replace('before every', 'before\n  every')]]), 1e6).length, 1);
// Short paragraphs (headings, one-liners) may repeat.
assert.deepEqual(check(new Map([['a.md', '## Steps'], ['b.md', '## Steps']]), 1e6), []);
// Fenced code is exempt: the same command may be shown where it is used.
const fence = '```bash\n' + para('node scripts/security-gate.ts body.md') + '\n```';
assert.deepEqual(check(new Map([['a.md', fence], ['b.md', fence]]), 1e6), []);

// An explained, deliberate repetition (a skill must stand alone) carries a quality-override pragma.
const kept = '// quality-override: No duplicate implementations — each skill loads alone\n' + rule;
assert.deepEqual(check(new Map([['skills/a.md', kept], ['skills/b.md', kept]]), 1e6), []);

// Non-canonical term: "the root" for the orchestrator. "root cause" and paths are fine.
assert.match(check(new Map([['skills/q.md', 'The root merges each lane.']]), 1e6)[0], /skills\/q\.md:1 .*"the root".*orchestrator/);
assert.match(check(new Map([['skills/q.md', 'x\nthe root\'s branch']]), 1e6)[0], /skills\/q\.md:2/);
assert.match(check(new Map([['skills/q.md', 'The root orchestrator owns it.']]), 1e6)[0], /orchestrator/);
for (const ok of ['find the root cause', 'at the root of the repo', 'the root directory', 'repo root', 'the root checkout'])
  assert.deepEqual(check(new Map([['skills/q.md', ok]]), 1e6), [], ok);

// Size budget per skill, with an inline escape for an indivisible skill.
assert.match(check(new Map([['skills/big.md', 'x'.repeat(50)]]), 40)[0], /skills\/big\.md is 50 bytes, over the 40-byte skill budget/);
assert.deepEqual(check(new Map([['skills/big.md', '<!-- quality-ok: skill-length — one protocol -->' + 'x'.repeat(50)]]), 40), []);
// The budget is for skills; AGENTS.md has its own check.
assert.deepEqual(check(new Map([['docs/agents-detail.md', 'x'.repeat(50)]]), 40), []);

console.log('check-guidelines.test: ok');
