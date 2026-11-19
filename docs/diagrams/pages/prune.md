[← Scaffold at a glance](system-map.md)

# Prune

How /prune runs every quality lens on a branch, then fixes the findings through the full feature chain instead of a one-shot patch.

```mermaid
flowchart LR
  n_audit["Audit"] --> n_design["Design doc"]
  n_design["Design doc"] --> n_prd["PRD"]
  n_prd["PRD"] --> n_tdd["TDD"]
  n_tdd["TDD"] --> n_pr["Pull request"]
  classDef lane0 fill:#bfdbfe,stroke:#1d4ed8,color:#1f2937
  classDef lane1 fill:#bbf7d0,stroke:#15803d,color:#1f2937
  classDef lane2 fill:#ddd6fe,stroke:#6d28d9,color:#1f2937
  class n_audit lane0
  class n_design,n_prd lane1
  class n_tdd,n_pr lane2
```

- [Audit](#audit): Run the correctness and structure reviews, read-only, and collect one findings table.
- [Design doc](#design-doc): Write the findings and how each kind will be fixed into design.md.
- [PRD](#prd): Turn the findings into user stories without re-interviewing.
- [TDD](#tdd): Build the fixes in slices, one group of fixes per slice, then refine.
- [Pull request](#pull-request): Open a PR whose body lists the findings and which IDs were addressed.

## Audit

Run the correctness and structure reviews, read-only, and collect one findings table.

- Correctness: /validate --effort max.
- Structure: the /simplify checklist, applied without auto-fix.
- Each finding is tagged [validate] or [quality].

## Design doc

Write the findings and how each kind will be fixed into design.md.

- Findings get IDs (F-01 and on) and are grouped by class, not handled one by one.
- Written to `docs/quality-<branch-short>/design.md` (the last segment of the branch name), committed, then /design-review auto-fixes it.

## PRD

Turn the findings into user stories without re-interviewing.

- Stories cite finding IDs.
- It names which fixes are risky enough to need tests.

## TDD

Build the fixes in slices, one group of fixes per slice, then refine.

Details: [TDD](tdd.md)

- /tdd runs /code-refiner when all slices pass.
- The review at the end of this step is the only pause.

## Pull request

Open a PR whose body lists the findings and which IDs were addressed.

Details: [PR workflow](pr-workflow.md)

**Where it breaks**

- At any step, stop, pause or just answer from the owner halts the run at once.

## Detailed flow

![Prune, detailed](../generated/prune.svg)

## Glossary

- **Lens**: One review angle: correctness or structure.
- **PRD**: Product requirements document: the problem, the solution and the user stories.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's /prune skill turns a quality audit
into a planned, tested cleanup PR.
Read this page:
https://github.com/victusfate/scaffold/blob/main/docs/diagrams/pages/prune.md
Scaffold: https://github.com/victusfate/scaffold

Questions worth asking:
- When is /prune worth it instead of running /simplify alone?
```
