# dependency-watch

Installs a scheduled check of what a repo already ships. It runs whether or not anyone opens a PR
(`security.yml` covers PRs).

- **osv-scanner** over every lockfile, for known vulnerabilities.
- **runtime check** of runtime pins (`.ruby-version`, `.node-version`, `.nvmrc`, `.python-version`,
  `.tool-versions`, Dockerfile `FROM` of official ruby/node/python/golang images). A pin is a finding
  when it is behind its release line's latest patch, read from the runtime's own release list, or when
  its line is end-of-life (per endoflife.date). This catches interpreter bugs before any advisory
  database lists them. On Ruby2Shell's disclosure day, OSV and GHSA had no entry, but ruby-lang's
  index already listed 3.4.13.
- **One tracking issue** (label `dependency-watch`): rewritten in place on every run and closed when a
  run is clean. Built only from structured fields, never advisory prose.
- **Security-only `dependabot.yml`** for the detected ecosystems (`open-pull-requests-limit: 0` turns
  off routine version-update PRs). The `/dependency-watch` skill turns on Dependabot security updates.

```bash
node tools/dependency-watch/run --detect-only --into ../my-app      # what would be installed
node tools/dependency-watch/run --into ../my-app                    # daily at 06:17 UTC
node tools/dependency-watch/run --into ../my-app --schedule "0 */12 * * *"
```

Run the check by hand in a repo that has it installed:
`node .github/dependency-watch/runtime-check.ts [--fix]` (exit 0 clean, 1 findings, 2 error). `--fix`
bumps behind pins to the latest patch; `/dependency-watch fix` does that and opens the PR.

Templates live in `lib/dependency-watch/`. The `/dependency-watch` skill wraps this tool.
GitHub pauses scheduled workflows in repos with no activity for 60 days. Re-enable from the Actions tab.
