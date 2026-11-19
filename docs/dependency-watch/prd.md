# PRD: dependency-watch

Decisions, vocabulary and evidence: [design.md](design.md). Slices: [plan.md](plan.md).

## Problem
`security.yml` scans only what a PR changes. Advisories published later against code already on main
go unnoticed, and runtime pins (`.ruby-version`, Dockerfile `FROM ruby:…`) are never checked. Ruby2Shell
(fixed in Ruby 3.3.14 / 3.4.13 / 4.0.10) had no OSV or GHSA entry on disclosure day.

## Solution
- **Informed:** a scheduled workflow (daily, owner cron) runs osv-scanner over every lockfile and a runtime
  check against upstream release lists and EOL data. Results go to one tracking issue, rewritten in place
  and closed when clean, with read-up links.
- **One instruction to patch:** `/dependency-watch fix` bumps behind pins and opens a PR as the owner
  (CI runs). Dependabot opens security PRs for packages. The owner merges.
- **No setup homework:** `/dependency-watch` installs the files and turns on Dependabot.

## User stories
1. A known-vulnerable dependency already on main is reported within one scheduled run.
2. A runtime pin behind its line's latest patch is reported before any advisory database lists it.
3. A pin on an end-of-life line is reported and left for an owner decision.
4. Findings live in one issue, never a flood; a failed check fails visibly and leaves the issue alone.
5. The owner chooses the cadence; re-running setup keeps it.
6. Existing `dependabot.yml` or workflow files are never clobbered (sidecars).
7. The issue holds only structured fields and fixed-template links, never advisory prose.
8. Patching is one instruction to the owner's agent; merging stays with the owner.

## Testing
Offline fixtures recorded from real payloads (2026-11-19); no live network in tests. The workflow's shell
step runs for real with `gh`, `curl` and osv-scanner stubbed. A scaffold-only test keeps this repo's
install identical to the templates. Live behavior is checked by hand (see tdd-log.md).

## Out of scope
Auto-merge, Renovate, OS base images (alpine/debian), runtimes beyond Ruby/Node/Python/Go,
SAST/fuzzing, changes to `security.yml`.
