# Implementation plan

- [x] Queue and import boundaries: typed contract references through all storage/CLI paths;
  enforce configured boundaries with isolated tests and a CI entry point.
- [x] Rigor: record real timed attempts, render daily stage metrics and reviewed
  false-positive rates; start consumers with strict lint/format defaults.
- [x] Mind Meld: registered build skill, validated graph/trace format, real flow
  and piece example, run diff, and an offline source/graph/trace viewer.
- [x] Integrate: scored system rubric, safe-modification guidance, consumer sync manifest,
  feature artifacts, and new test commands.
- [x] Design feedback (#166): scored intent/learning/understanding/repairability,
  canonical outcome and hypothesis prompts, truthful metrics scope, and rubric checks.
- [ ] Validate: full suites, CLI/live viewer QA, independent correctness and
  structural/security review, final origin/main security gate, hosted checks.
- [ ] Deliver: one PR from feat/durability-mind-meld, squash merge its validated
  head, verify main contains it, close all three issues referencing branch and PR.

Use the issue acceptance criteria as slice boundaries. Keep each lane isolated;
merge the current working branch into each lane before integration. Record actual
RED/GREEN results and remaining limitations in tdd-log.md and qa-report.md.
