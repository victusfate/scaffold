# TDD log: dependency-watch

## Slice 1 — .ruby-version behind latest patch
- Status: done
- Notes: tracer through parsePins → classify. Release line = major.minor. `today` deferred to slice 3 (EOL).

## Slice 2 — other pin files and Dockerfile FROM
- Status: done
- Notes: split parsing into `pins.ts` (Pin is a union: exact / floating / unchecked). Node line = major.
  Untagged runtime image → floating. Pin above its line's latest, or no release data → unchecked.

## Slice 3 — upstream release parsers and EOL findings
- Status: done
- Notes: `releases.ts` holds source URLs + parsers. Fixtures are trimmed real payloads from 2026-11-19.
  Malformed or empty payloads throw. EOL applies to exact and floating pins; `behind` and `eol`
  are separate findings. `classify` takes an injected ISO date.

## Slice 4 — runtime-check CLI
- Status: done
- Notes: tracked files only (`git ls-files`); fetches only pinned runtimes; `--releases` offline,
  `--today` injectable. `isPinFile` shares the parser dispatch in `pins.ts`.
- Live probe 2026-11-19 [verified: ran against a scratch repo]: `.ruby-version 3.4.12` → behind 3.4.13
  (Ruby2Shell, disclosure day), `python:3.13.8` → behind 3.13.18, `node:20` → eol 2026-04-30.

## Slice 5 — tracking-issue report
- Status: done
- Notes: one row per (file, package), ids linked to osv.dev, fixed versions highest-first (display only).
  Summaries/details never read; ids/versions outside a safe charset dropped; cells escaped. Fixture
  `osv-gems.json` is real osv-scanner 2.7.0 output (trimmed) with an injected prompt in summary/details.

## Slice 6 — scheduled workflow template
- Status: done
- Notes: structural test (`workflow.test.ts`) plus `workflow-run.test.ts`, which runs the real shell step
  with stubbed gh/curl/osv-scanner: create / edit-oldest / close / untouched-on-error. Findings do not
  fail the job (no daily failure mail). `report.ts` now writes `--body-out` and prints the status, so
  the step needs no jq. zizmor 1.30.1 (pinned): no findings [verified: local run].

## Slice 7 — tool detect
- Status: done
- Notes: `tools/dependency-watch/setup.ts` renders the exact files emit would write; a file's state is
  none / scaffold (identical) / stale (has marker, differs) / foreign (no marker). Pins come from the
  shipped `pins.ts` (one parser). Fixtures/testdata/vendor trees excluded.
