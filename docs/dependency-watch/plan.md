# Plan: dependency-watch

From [prd.md](prd.md). Each slice runs RED → GREEN → REFACTOR and ends in a commit.
Tests: `lib/dependency-watch/*.test.ts` (pure modules + CLIs, fixtures in `lib/dependency-watch/fixtures/`)
and `tools/dependency-watch/test` (detect/emit in temp git repos). All are wired into `npm test`.

| # | Slice | Behaviors | Status |
|---|---|---|---|
| 1 | Tracer: `.ruby-version` behind latest patch | parse `3.4.12` / `ruby-3.4.12`; given releases with 3.4.13 → `behind` finding; on latest → none | done |
| 2 | Other pin files | `.node-version`, `.nvmrc` (`v`, `lts/*` unchecked), `.python-version`, `.tool-versions`; Dockerfile `FROM` (prefix, `--platform`, `AS`, variants, floating → info, digest/`${ARG}` → unchecked, other images ignored); pin above highest known → unchecked | done |
| 3 | Release adapters + EOL | parse recorded ruby index.txt, node index.json, go json, python json fixtures; EOL from endoflife.date fixture with injected clock → `eol` finding | done |
| 4 | `runtime-check.ts` CLI | `--root`, `--releases <dir>` offline; JSON out; exit 0 clean / 1 findings / 2 fetch or parse error | done |
| 5 | `report.ts` | merge runtime + osv JSON into `{status, body}`; structured fields only (injection fixture never appears); deterministic order; 200-row cap; clean status | done |
| 6 | Workflow template | daily default cron placeholder, push/dispatch triggers, `issues: write`, pinned SHAs + osv sha256, single-issue find/edit/create/close, exit-2 leaves issue alone, concurrency | done |
| 7 | Tool detect | ecosystems from tracked lockfiles/manifests with directories; runtime pins; file states none/foreign/scaffold/stale | done |
| 8 | Tool emit | writes via safeWrite; `--schedule` substitution + 5-field validation; dependabot.yml security-only; sidecar on foreign; idempotent; unknown flag exit 1 | done |
| 9 | Skill + dogfood | `skills/dependency-watch.md`, RESOLVER, generated wrappers, docs/skills.md, tools/README, package.json test entries; emit into scaffold itself | done |
