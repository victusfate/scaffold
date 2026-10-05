# Plan: upstream-skills

Each slice cuts through test → canonical skill → wrappers → registration → flow wiring.

## Slice 1 — `/deslop`
- RED: `scripts/test-deslop-skill.sh` (files, modes, pattern list, voice rule, eval
  checklist, credit line, wrappers, manifest, RESOLVER, `/create-pr` Step 6 wiring).
- GREEN: `skills/deslop.md`, 4 wrappers, RESOLVER row, manifest, create-pr Step 6.

## Slice 2 — `/investigate`
- RED: `scripts/test-investigate-skill.sh` (four phases, no-fix-before-root-cause law,
  3-failed-fixes stop, evidence gate, credit, wrappers, registration, wiring in
  `/create-pr` Step 2 and `/tdd`).
- GREEN: `skills/investigate.md`, wrappers, registration, wiring.

## Slice 3 — `/qa`
- RED: `scripts/test-qa-skill.sh` (surfaces, clean-tree check, tiers, regression test
  before fix, re-verify, stop rule, report, skip guard, credit, wrappers,
  registration, `/feature-chain` Phase 3 + Phase 4 wiring).
- GREEN: `skills/qa.md`, wrappers, registration, wiring.

## Finish
- Regenerate `docs/skills.md`, add tests to `package.json`, full `npm test`, lint, typecheck.
