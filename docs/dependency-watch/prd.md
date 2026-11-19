# PRD: dependency-watch

Design: [design.md](design.md). Vocabulary below follows it.

## Problem Statement
A scaffold repo only scans for vulnerabilities when a PR changes a lockfile (`security.yml`). An advisory
published against code already on main goes unnoticed until someone happens to touch that lockfile.
Runtime pins (`.ruby-version`, Dockerfile `FROM ruby:...`) are never checked at all, so an interpreter bug
like Ruby2Shell (fixed in Ruby 3.3.14 / 3.4.13 / 4.0.10, absent from OSV and GHSA on disclosure day) is
invisible. Consumer repos have no one-step way to set any of this up.

## Solution
`/dependency-watch` sets up three things in any repo:
1. A scheduled workflow (daily by default, owner-configurable cron, also on push to main and manual
   dispatch). It runs osv-scanner over the whole repo and runs a runtime check of every runtime pin
   against upstream release lists and EOL data. Results go into **one** tracking issue that is
   rewritten in place and closed when clean.
2. A security-only `dependabot.yml` for the detected ecosystems, so advisories against packages arrive
   as PRs that run normal CI.
3. Optionally, with confirmation, the repo settings that turn on Dependabot alerts and security updates.

## Outcome and Evidence
- Desired improvement: time from an advisory or runtime patch release to a visible signal is at most one
  scheduled interval, with no PR required. Noise stays bounded at one issue per repo.
- Assumptions and probes are in [design.md#assumptions](design.md#assumptions). Two were disproved by
  curl on 2026-11-19 and shaped the design (endoflife.date lag, no OSV/GHSA entry on day 0).
- Revise the design if: an upstream release list lags or changes format (adapter test fixtures stop
  matching live data), or Dependabot opens version-update PRs despite `open-pull-requests-limit: 0`.
- Outcome evidence (separate from tests passing): unknown until observed. Check by running the workflow on
  this repo, and by a consumer repo receiving a Dependabot security PR or tracking issue.
- Preservation: `security.yml` unchanged; consumer files go through `tools/lib/safe-write.ts`; the
  detect/emit state model matches `tools/linter-setup/detect.ts`.

## User Stories
1. As a repo owner, I want a known-vulnerable dependency already on main reported within a day, so a
   fix doesn't wait for an unrelated PR.
2. As a repo owner, I want a runtime pin that is behind its line's latest patch reported, even before
   any advisory database lists the bug, so interpreter bugs like Ruby2Shell are caught on day 0.
3. As a repo owner, I want a pin on an end-of-life line reported, so I know it will get no more fixes.
4. As a repo owner, I want all findings in one issue that updates itself and closes when clean, so I
   never come back to hundreds of issues.
5. As a repo owner, I want to choose how often the scan runs (daily by default), so cost and latency fit
   the project.
6. As a repo owner, I want Dependabot security PRs for my ecosystems and no routine version-bump PRs.
7. As a repo owner with an existing `dependabot.yml` or workflow, I want my files left untouched and a
   sidecar proposed, so setup never clobbers my config.
8. As a repo owner who set this up earlier, I want to be told when scaffold's templates changed and be
   able to re-emit.
9. As an agent reading the tracking issue, I want only structured fields (ids, packages, versions,
   files, links), so advisory prose can't act as instructions.
10. As a repo owner, I want a failed check (network outage, parse error) to fail visibly and not close
    the issue, so "clean" always means checked.
11. As a repo owner, I want floating pins (`ruby:3.4-slim`) and unsupported pins (digests, `lts/*`,
    other runtimes) reported as info/unchecked and never dropped silently.
12. As the scaffold maintainer, I want scaffold itself to run the same workflow, so the template is
    exercised in a real repo.

## Implementation Decisions
- **Templates** (`lib/dependency-watch/`): `dependency-watch.yml` (workflow), `runtime-check.ts`,
  `report.ts`, and `versions.ts` (shared pure module: pin parsing, version comparison, release
  adapters). Each runtime-shipped file carries a marker line `// scaffold-dependency-watch sha256:<hash>`
  (`#` form in YAML) for staleness. The runtime-shipped TS files import only `node:` builtins and each
  other, so the consumer needs no `npm install`.
- **Pin parsing** (pure): `.ruby-version` (optional `ruby-` prefix), `.node-version`, `.nvmrc`
  (optional `v`; `lts/*` and names unchecked), `.python-version`, `.tool-versions` (`ruby`, `nodejs`,
  `python`, `golang`), and `Dockerfile*` `FROM` lines for official `ruby`, `node`, `python`, `golang`
  images (optional `docker.io/library/` prefix, `--platform` flag, `AS` stage, tag variants like
  `-slim`/`-alpine3.20`). Digests and `${ARG}` images are unchecked. Other images are ignored.
- **Release adapters**: each turns a raw upstream payload into a sorted version list. Sources: ruby-lang
  `index.txt`, nodejs.org `dist/index.json`, go.dev `?mode=json&include=all`, python.org release API.
  EOL per line from endoflife.date `/api/<product>.json`. Fetching is separate from parsing, and
  `--releases <dir>` substitutes fixture files named `<runtime>.json|txt` and `eol-<runtime>.json`.
- **Classification** (pure): full-patch pin → `behind` if a higher patch exists in its line; `eol` if
  the line's EOL date is before today (injected clock); both can apply (one finding per kind). Pin
  above the highest known release → unchecked ("unknown version"). Line unknown to EOL data → no EOL
  finding.
- **report.ts** (pure): merges runtime-check JSON and osv-scanner JSON (`--format json`) into
  `{ status, body }`. osv fields used: result source path, package name/ecosystem/version, vuln id,
  fixed versions from `affected[].ranges[].events[].fixed`. Body sorted deterministically, capped at
  200 rows with a "+N more" line. The body starts with a hidden marker comment.
- **Workflow**: triggers `schedule` (cron from `--schedule`, default `17 6 * * *`), `push` to default
  branch, `workflow_dispatch`. Permissions `contents: read`, `issues: write`. Steps: pinned checkout,
  pinned setup-node, pinned osv-scanner with sha256 check (same pins as `security.yml`), runtime check,
  report, then one shell step: find open issues labeled `dependency-watch` (oldest first); findings →
  edit the oldest or create; clean → close it; runtime-check exit 2 or an unexpected osv-scanner exit →
  fail the job without touching the issue. Concurrency group prevents overlapping runs.
- **Tool** `tools/dependency-watch/` (`tool.yaml`, `run`, `test`, `README.md`):
  `--detect-only --into <repo>` → JSON `{ ecosystems, runtimePins, files: [{ path, state }] }`.
  `--into <repo> [--schedule "<cron>"] [--only workflow,dependabot]` → writes through `safeWrite`,
  returns JSON `{ written, sidecars, skipped }`. Rejects unknown flags and an invalid cron (not 5
  fields) with exit 1. No network. Ecosystem detection maps lockfiles/manifests to Dependabot
  ecosystems (`bundler`, `npm`, `pip`, `cargo`, `gomod`, `composer`, `docker`, `github-actions`),
  with directories from `git ls-files`.
- **dependabot.yml**: version 2; one `updates` entry per ecosystem and directory;
  `schedule.interval: daily`, `open-pull-requests-limit: 0`. Marker comment for staleness.
- **Skill** `skills/dependency-watch.md` + RESOLVER entry + generated wrappers: detect, ask once (files
  to write, cron with daily default), emit, show sidecar merges like `/add-linter`, then offer the
  `gh api` calls to enable vulnerability alerts and automated security fixes, with confirmation.
- **Scaffold dogfood**: run the tool into this repo (workflow + dependabot for `npm` and
  `github-actions`).

## Testing Decisions
- Good test: drives the public contract (CLI JSON and exit code, or the pure function's return value)
  with fixtures, never live network. Network adapters are tested by parsing recorded payload fixtures
  trimmed from real responses captured 2026-11-19.
- Tested: `versions.ts` (pin parsing per file type, comparison, classification incl. Ruby2Shell case
  3.4.12 → 3.4.13), `runtime-check.ts` CLI (fixtures dir, exit codes 0/1/2), `report.ts` (structured
  fields only; a fixture vuln whose `summary`/`details` hold an injection string must not appear in the
  body; cap and ordering), tool `run` (detect states none/foreign/scaffold/stale, emit idempotent,
  sidecar on foreign, cron validation, unknown flag), workflow template (parses as YAML via a minimal
  structural check: required triggers, permissions, pinned `uses:` SHAs).
- Prior art: `tools/linter-setup/test` (temp git repo, detect/emit), `scripts/*.test.ts` style.
- Diagnosis: `node .github/dependency-watch/runtime-check.ts --root .` reproduces a run locally; with
  `--releases <dir>` it replays recorded upstream data.
- Not unit-tested: the `gh issue` shell step (checked by running the workflow on this repo, recorded as
  outcome evidence) and live adapters (a fixture refresh is a manual step).

## Out of Scope
- Auto-merge of Dependabot PRs (separate owner decision).
- Renovate, routine version updates, bot PRs for runtime pins.
- OS/base images other than the four language runtimes (alpine, debian, ubuntu), container image
  scanning (Trivy/Grype), SAST/fuzzing.
- Runtimes beyond Ruby, Node, Python and Go.
- Changing `security.yml`.

## Further Notes
- osv-scanner exit codes: 0 clean, 1 vulns, 128 no packages; anything else is an error.
- GitHub may disable scheduled workflows in repos with no activity for 60 days; the README notes it.
