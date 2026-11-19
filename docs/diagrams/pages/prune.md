# Prune

How /prune runs every quality lens on a branch, then fixes the findings through the full feature chain instead of a one-shot patch.

```mermaid
flowchart LR
  audit["Audit"] --> design["Design doc"]
  design["Design doc"] --> prd["PRD"]
  prd["PRD"] --> tdd["TDD"]
  tdd["TDD"] --> pr["Pull request"]
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
- Written to docs/quality-BRANCH/design.md, committed, then /design-review auto-fixes it.

## PRD

Turn the findings into user stories without re-interviewing.

- Stories cite finding IDs.
- It names which fixes are risky enough to need tests.

## TDD

Build the fixes in slices, one group of fixes per slice, then refine.

Goes deeper: [tdd.md](tdd.md)

- /tdd runs /code-refiner when all slices pass.
- The review at the end of this step is the only pause.

## Pull request

Open a PR whose body lists the findings and which IDs were addressed.

Goes deeper: [pr-workflow.md](pr-workflow.md)

**Where it breaks**

- At any step, stop, pause or just answer from the owner halts the run at once.

<details>
<summary>Detailed flow</summary>

![Prune, detailed](../generated/prune.svg)

</details>

## Glossary

- **Lens**: One review angle: correctness or structure.
- **PRD**: Product requirements document: what to build and how we know it's done.

## Ask your LLM

Copy this block into your own assistant to ask about anything on this page.

```text
The reader wants to understand how scaffold's /prune skill turns a quality audit into a planned, tested cleanup PR.

Prune: How /prune runs every quality lens on a branch, then fixes the findings through the full feature chain instead of a one-shot patch.
- Audit: Run the correctness and structure reviews, read-only, and collect one findings table.
- Design doc: Write the findings and how each kind will be fixed into design.md.
- PRD: Turn the findings into user stories without re-interviewing.
- TDD: Build the fixes in slices, one group of fixes per slice, then refine.
- Pull request: Open a PR whose body lists the findings and which IDs were addressed.

Questions worth asking:
- When is /prune worth it instead of running /simplify alone?
```
