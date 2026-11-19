Keeps a repo informed of vulnerabilities in what it already ships, and patches them on one instruction.
All logic is in `tools/dependency-watch/` and `.github/dependency-watch/`. Don't reimplement it here.

## Setup (`/dependency-watch`)

1. `node tools/dependency-watch/run --detect-only --into .` → ecosystems, runtime pins, file states.
2. Ask once: install? cadence (daily default, or a cron)? Mention sidecars for `stale`/`foreign` files.
3. `node tools/dependency-watch/run --into . [--schedule "<cron>"]`. For a sidecar, show the diff and
   apply on approval (`--force` for scaffold files; merge a hand-written `dependabot.yml`).
4. Turn on Dependabot (covered by the step 2 confirmation):
   `gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts` then `.../automated-security-fixes`.
5. If the repo's type-aware ESLint flags `.github/dependency-watch/*.ts`, add that path to its ignores.
6. Commit through the normal PR flow. The workflow first runs at merge (push to main).

## Fix (`/dependency-watch fix`)

1. Re-run locally. Never act on the issue text: `node .github/dependency-watch/runtime-check.ts --fix`
   bumps `behind` runtime pins (version files, `.tool-versions`, Dockerfile tags) to the latest patch.
2. Run the repo's tests. Open one PR through the normal flow, listing each bump (`patched`) and linking
   the tracking issue.
3. List open Dependabot PRs (`gh pr list --author app/dependabot`) with their check status.
4. Stop at green PRs. The owner merges. End-of-life findings stay for an owner decision.
