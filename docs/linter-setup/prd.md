# PRD: Language-Linter Setup

## Problem Statement

Scaffold enforces code quality through a model-driven rubric and a mechanical
shell script. The shell script is language-agnostic but blunt — it covers file
length, magic literals, and commented-out code for any language via regex. It
does not check cyclomatic complexity or per-language structural rules. Consumer
repos that add Python, Go, Rust, or other languages have no automatic quality
gate for those languages unless they wire one in manually.

## Solution

Two new components added to scaffold:

1. **`tools/linter-setup/`** — a Node.js tool that detects languages present in
   a consumer repo, checks for existing linter configs (with or without scaffold
   quality thresholds), prompts the user once per language via the agent, and
   emits config + workflow files from `lib/linters/<language>/` into the consumer
   repo.

2. **`lib/linters/<language>/`** — per-language template files (linter config +
   GitHub Actions workflow) covering the rubric's four quantitative metrics: file
   length ≤500 lines, parameter count ≤4, cyclomatic complexity ≤10, and magic
   numbers. Templates are owned by scaffold and synced downstream via the existing
   sync mechanism.

`/sync-scaffold` calls `tools/linter-setup/run --detect-only` at the end of
each sync and reports any languages without linter setup. The `/add-linter`
skill invokes the tool in full mode to prompt and emit.

## User Stories

1. As a consumer repo developer, I want scaffold to detect that I've added Python
   files and tell me I can add Ruff, so I don't have to remember to wire it in.
2. As a developer, I want to confirm or decline each language's linter
   individually, so I keep control over my CI configuration.
3. As a developer who already has ESLint configured, I want scaffold to detect
   that its quality thresholds aren't present and offer to add them, rather than
   silently overwriting my config.
4. As a developer, I want the emitted linter configs to enforce the same rubric
   thresholds (file length, param count, complexity, magic numbers) that
   scaffold's model-driven review uses, so the CI gate is consistent with the
   review gate.
5. As a maintainer, I want the scaffold marker (`# scaffold-linter: <lang>`)
   in each emitted config to act as the sentinel — no separate tracking file.
6. As a developer using Swift or Dart (unsupported languages), I want a clear
   message that scaffold has no registry entry, not a silent skip or an error.
7. As a scaffold contributor, I want the linter templates tested for marker
   presence and threshold coverage so regressions are caught in CI.
8. As a developer on a Zig or Mojo project, I want a formatter workflow emitted
   even though no complexity linter exists yet.

## Implementation Decisions

### Tool: `tools/linter-setup/`

Follows the `tools/hoist-skill/` pattern: a `run` entry point, a `test` unit
suite, and a `test-integration` integration suite. JSON to stdout, errors to
stderr, non-zero exit on any failure.

Two modes via CLI flag:
- `--detect-only` — scan `git ls-files` for known extensions, return JSON array
  of `{ language, state }` where `state` is `none | foreign | scaffold`. No
  writes, no prompts. Used by sync.
- Full mode (no flag) — detect, read prompt responses from stdin (JSON array of
  `{ language, confirmed: bool }` written by the agent after `AskUserQuestion`),
  emit confirmed languages.

`--into <path>` defaults to `process.cwd()`.

Internal modules:
- `registry.mjs` — static map of language → `{ extensions, linter, configFile,
  workflowFile, marker }`. Single source of truth for all supported languages.
- `detect.mjs` — runs `git ls-files` in the target repo, maps extensions to
  languages via registry, checks for existing config files and scaffold markers.
- `emit.mjs` — copies `lib/linters/<lang>/<file>` into target repo at the
  correct paths. Clobber-safe: writes sidecars on conflict (same contract as
  sync). Handles `adopt` mode (merge thresholds into existing config) as a
  future extension — out of scope for this PRD.

### Templates: `lib/linters/<language>/`

Each language directory contains:
- A linter config file with scaffold quality thresholds and the scaffold marker
- A GitHub Actions workflow file that runs the linter on PRs (changed files only)

**Rubric coverage per language:**

| Language | Linter | File ≤500 | Params ≤4 | Complexity ≤10 | Magic numbers |
|----------|--------|-----------|-----------|----------------|---------------|
| JS/TS | ESLint | `max-lines` | `max-params` | `complexity` | `no-magic-numbers` |
| Python | Ruff | `PLR0914` | `PLR0913` | `C901` | `PLR2004` |
| Go | golangci-lint | `funlen` | `revive` | `cyclop`+`gocognit` | `mnd` |
| Rust | Clippy | `too_many_lines` | `too_many_arguments` | `cognitive_complexity` | `unreadable_literal` (partial) |
| Ruby | RuboCop | `ModuleLength` | `ParameterLists` | `CyclomaticComplexity` | not available |
| Shell | Shellcheck | — (mechanical check) | — | — | — (mechanical check) |
| Elixir | Credo | `MaxModuleLength` | `FunctionArity` | `CyclomaticComplexity` | not available |
| Zig | zig fmt | format only | — | — | — |
| Mojo | mojo format | format only | — | — | — |

Magic number gaps in Ruby and Elixir are documented in the emitted config with a
comment noting the mechanical check still covers `.rb` and `.ex` files.

### Sync Integration

`tools/sync/run.mjs` calls `tools/linter-setup/run --detect-only --into <target>`
at the end of a successful sync. If any languages have `state: none`, sync
appends the suggestion message to its output. Detection is owned entirely by the
linter-setup tool — sync does not duplicate extension logic.

### Skill: `skills/add-linter.md`

Follows the standard scaffold skill pattern: registered in RESOLVER, wrapped for
all harnesses. Invokes `tools/linter-setup/run --detect-only` first, then uses
`AskUserQuestion` to present per-language yes/no prompts, then invokes full mode
with the confirmed languages as JSON stdin.

### Files Added to Scaffold Manifest

All `lib/linters/**` files and `tools/linter-setup/` are added to
`.github/scaffold-files.txt` so they propagate to downstream repos via sync.

## Testing Decisions

Prior art: `tools/hoist-skill/test` (unit, Node.js, fixture-based),
`tools/hoist-skill/test-integration` (full lifecycle), `scripts/test-audit-skill.sh`
(grep assertions on skill markdown).

Three test modules:

**1. `tools/linter-setup/test`** — unit tests using temp directory fixtures:
- Detection: repo with `.py` files → Python detected; repo with no known
  extensions → empty result; mixed-language repo → all detected.
- State detection: config with scaffold marker → `scaffold`; config without
  marker → `foreign`; no config → `none`.
- Emission: confirmed language → config + workflow written; declined → nothing
  written; `--detect-only` → nothing written.
- Unsupported language: detected extension not in registry → reported, not emitted.
- Clobber safety: existing file differs → sidecar written, original untouched.

**2. `tools/linter-setup/test-integration`** — full lifecycle:
- Fresh repo with JS + Python files, no linter configs → both detected as `none`,
  both confirmed → both emitted → scaffold markers present in output files.
- Repo with ESLint but no scaffold marker → detected as `foreign` → adopt prompt
  surfaced in JSON output.
- `--detect-only` → no files written, correct JSON returned.

**3. `scripts/test-linter-setup.sh`** — grep assertions on template files:
- Each config template contains `# scaffold-linter: <lang>` or equivalent marker.
- Each config template (except Zig/Mojo) contains at least one threshold matching
  the rubric (file-length, params, complexity).
- Each workflow template contains a `on: pull_request` trigger.
- Wired into `npm test`.

## Out of Scope

- Running the linters (the tool only sets them up)
- `adopt` mode — merging scaffold thresholds into a foreign config (prompt is
  surfaced but emission only covers the `none` state in this PRD)
- Per-language threshold customization beyond the scaffold defaults
- Removing or downgrading an installed linter
- Mojo + Ruff hybrid (deferred until Mojo syntax stabilizes)
- zwanzig (Zig) and MOJOFuzzer (Mojo) — excluded pending tool verification

## Further Notes

- The `adopt` mode (state: `foreign`) is surfaced in the prompt but emit is
  skipped for now. A follow-on PRD can add threshold-injection into existing
  configs once the pattern is proven for `none` state.
- Shell is intentionally not in the linter registry — Shellcheck is correctness-
  only and the mechanical check already covers file-length/magic-numbers for
  `.sh` files. A consumer wanting strict shell quality should use the mechanical
  check + optional Shellcheck config manually.
