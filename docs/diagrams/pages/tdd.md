[← Scaffold at a glance](system-map.md)

# TDD

How a feature gets built one thin slice at a time: a failing test, the least code that passes it, a quality check, a commit.

```mermaid
flowchart LR
  n_slices["Plan the slices"] --> n_prep["Before code"]
  n_prep["Before code"] --> n_loop["Red, then green"]
  n_loop["Red, then green"] --> n_refactor["Refactor check"]
  n_refactor["Refactor check"] --> n_commit["Commit and log"]
  n_commit["Commit and log"] --> n_done["All slices pass"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  classDef lane2 fill:#ddd6fe,stroke:#6d28d9,color:#1f2937
  class n_slices lane0
  class n_prep,n_loop,n_refactor,n_commit lane1
  class n_done lane2
```

- [Plan the slices](#plan-the-slices): Split the PRD into vertical slices and confirm their size once with the user.
- [Before code](#before-code): For each slice, decide the interface and list the behaviors to test.
- [Red, then green](#red-then-green): Write one failing test, then the least code that makes it pass, and repeat.
- [Refactor check](#refactor-check): Score each touched file on the four-part rubric and audit the tests before committing.
- [Commit and log](#commit-and-log): Commit the red, green and refactor steps, log the slice, then start the next one.
- [All slices pass](#all-slices-pass): Run the full suite, then /code-refiner, then stop for the user's review.

## Plan the slices

Split the PRD into vertical slices and confirm their size once with the user.

- If plan.md is missing, the agent writes it from prd.md first.
- Each slice cuts through every layer
  - Data, logic, UI and tests together.
  - After the size is confirmed, slices run without pausing unless an interface change departs from plan.md or a large fix must be surfaced.

## Before code

For each slice, decide the interface and list the behaviors to test.

- List behaviors, not implementation steps.
- Name the assumption the slice tests
  - Use the design's evidence, or mark it unknown.
  - If a probe contradicts the intent, revise the design, PRD and unfinished slices first.

## Red, then green

Write one failing test, then the least code that makes it pass, and repeat.

Details: [Investigate](investigate.md)

- The first test is a tracer bullet: one behavior, proving the path works end to end.
- Tests use the public interface only, so they survive an internal refactor.

**Where it breaks**

- Writing all tests first verifies imagined behavior; one test at a time keeps them honest.
- A test that fails for a different reason, or an old test that breaks, stops the loop for /investigate.

## Refactor check

Score each touched file on the four-part rubric and audit the tests before committing.

- Every score must be 10/10
  - A fix under 30 lines is applied in place, then re-tested and re-scored.
  - A bigger fix is surfaced to the user, never silently patched.
- Test self-audit
  - Assertions use sentinel values, not defaults.
  - Every form of a new flag is covered.
  - At least one test is written from the caller's side.

## Commit and log

Commit the red, green and refactor steps, log the slice, then start the next one.

- Commits: test (red), feat (green), and refactor only if something was refactored.
- Each slice's status is appended to tdd-log.md.

## All slices pass

Run the full suite, then /code-refiner, then stop for the user's review.

Details: [Review gates](review-gates.md)

- /code-refiner runs in auto-fix mode: correctness and structure reviews, then one fix pass.
- A summary lists what was built, the tests and any deviation from the plan.

## Detailed flow

![TDD, detailed](../generated/tdd.svg)

## Glossary

- **Vertical slice**: A thin piece of a feature that cuts through every layer and works on its own.
- **Rubric**: Four scores for code: Quality, Readability, Encapsulation, Clarity.
- **Sentinel value**: A non-default test value, so a bug that silently resets a field can't hide.
- **Tracer bullet**: The first test, which proves the path works end to end.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's /tdd skill builds a feature
test-first, one slice at a time.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/tdd.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- Why list behaviors to test instead of implementation steps?
- What goes wrong if you write all the tests before any code?
```
