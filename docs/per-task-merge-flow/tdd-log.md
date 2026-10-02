# TDD log

- RED: `node scripts/queue-delivery.test.ts` failed because deliveryMode was absent.
- GREEN: focused model/CLI tests pass, including persisted completion, same-task
  retry, legacy active completion/failure, failed archive rejection, explicit
  advance evidence and legacy batch selection. Existing parallel tests retain
  their assertions under explicit batch configuration.
- Independent review found legacy active transitions losing selection and failed
  archives accepting advance. Fixed both; added regression assertions. Structural
  review fixes clarify batch prompts and extract the driver reference.
- Final verification: `npm test`, `npm run test:integration`, `npx eslint .`
  (0 errors; 291 warnings), and `npx tsc --noEmit` passed. Independent
  correctness review has no remaining findings; structural review passes after
  the driver-reference link correction. No aggregate `make ci` gate exists.
