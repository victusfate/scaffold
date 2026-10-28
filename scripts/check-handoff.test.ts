import assert from 'node:assert/strict';
import { check, MAX_LINES } from './check-handoff.ts';

const good = [
  '# Handoff — x',
  '- **When / branch:** 2026-10-28 · `feat/x`',
  '## State',
  '- Lint passes on the branch. [verified: `npm run lint`]',
  '- The retry wrapper is probably unnecessary. [unverified]',
  '## Next steps',
  '1. Run `npm test`.',
].join('\n');
assert.deepEqual(check(good), []);

// Poisoning: a State bullet with no verification tag is a claim later turns would act on as fact.
assert.match(check(good + '\n## State\n- The driver retries on its own.')[0] ?? '', /State.*line 9.*\[verified: <cmd>\] or \[unverified\]/);
const untagged = good.replace(' [unverified]', '');
assert.match(check(untagged)[0], /line 5/);
// An empty verification is not a verification.
assert.equal(check(good.replace('[verified: `npm run lint`]', '[verified: ]')).length, 1);
// Continuation lines and non-bullets inside State are fine.
assert.deepEqual(check(good.replace('## Next steps', '  wrapped detail\n## Next steps')), []);

// Missing State section: nothing tells the reader which facts were checked.
assert.match(check('# Handoff\n## Next steps\n1. go')[0], /no '## State' section/);

// Clash: a correction left next to the claim it corrects.
for (const marker of ['Correction: it was the cache', 'UPDATE: actually fixed', '~~old fact~~ new fact', 'This is superseded by D2', 'EDIT: wrong branch']) {
  const errors = check(good + '\n' + marker);
  assert.equal(errors.length, 1, marker);
  assert.match(errors[0], /line 8.*rewrite the fact in place/, marker);
}
// "update" as an ordinary word is not a marker.
assert.deepEqual(check(good + '\nRun the update script.'), []);

// Distraction: a handoff that grew into a log.
const long = good + '\n' + Array.from({ length: MAX_LINES }, (_, i) => `note ${i}`).join('\n');
assert.match(check(long).at(-1) ?? '', new RegExp(`over the ${MAX_LINES}-line limit`));

console.log('check-handoff.test: ok');
