# Design: Language-Linter Setup

## Problem

Scaffold enforces code quality through a model-driven rubric and a mechanical
shell script. The mechanical script is language-agnostic but blunt — it checks
file length, magic literals, and commented-out code via regex. It does not check
cyclomatic complexity, parameter counts, or language-specific structural rules.

Consumer repos that add Python, Go, Rust, or other languages have no automatic
quality gate for those languages unless they wire one in manually.

## Solution

Two components:

1. **`tools/linter-setup/`** — a Node.js tool that detects languages in a
   consumer repo, checks for existing linter configs (with or without scaffold
   thresholds), prompts the user once per language, and emits config + workflow
   files from `lib/linters/<language>/`.

2. **`lib/linters/<language>/`** — template files (linter config + GitHub
   Actions workflow) for each supported language, owned by scaffold and synced
   to consumers via the existing sync mechanism.

`/sync-scaffold` detects languages and suggests running `/add-linter`. The
`/add-linter` skill invokes `tools/linter-setup/run` to do the actual work.

## Linter Registry

| Language | Linter | Quality metrics |
|----------|--------|-----------------|
| JS/TS | ESLint | `max-lines`, `max-params`, `complexity` |
| Python | Ruff | `max-doc-length`, McCabe complexity (`C901`) |
| Go | golangci-lint | `cyclop`, `funlen`, `gocognit` |
| Rust | Clippy | complexity lints |
| Ruby | RuboCop | `MethodLength`, `CyclomaticComplexity` |
| Shell | Shellcheck | correctness |
| Elixir | Credo | `MaxFunctionLength`, `CyclomaticComplexity`, `MaxModuleLength` |
| Zig | `zig fmt` | formatting only |
| Mojo | `mojo format` | formatting only |

## Detection

Language detection uses file extensions scanned via `git ls-files`:

| Extension | Language |
|-----------|----------|
| `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx` | JS/TS |
| `.py` | Python |
| `.go` | Go |
| `.rs` | Rust |
| `.rb` | Ruby |
| `.sh`, `.bash` | Shell |
| `.ex`, `.exs` | Elixir |
| `.zig` | Zig |
| `.mojo`, `.🔥` | Mojo |

## Prompt Behavior

**Once per language per repo.** No separate sentinel file — the emitted config
files carry a `# scaffold-linter: <language>` marker. Presence of the marker
means already set up; absence means prompt.

Three prompt states per detected language:

1. **No linter config found** → "No linter detected for Python — add Ruff with
   scaffold quality thresholds? [y/n]"
2. **Linter config found, no scaffold marker** → "Ruff found but scaffold quality
   thresholds not detected — adopt scaffold config? [y/n]"
3. **Scaffold marker present** → skip silently.

User answers y/n per language. `/add-linter` skips any language the user declines.

## What Gets Emitted

Per language (on yes):

- **Config file** — e.g. `ruff.toml`, `eslint.config.mjs`, `.golangci.yml`.
  Contains scaffold quality thresholds and the `# scaffold-linter: <lang>` marker.
- **GitHub Actions workflow** — `.github/workflows/lint-<language>.yml`. Runs
  the linter on PRs, changed files only (`VALIDATE_ALL_CODEBASE: false`
  equivalent per tool).

Zig and Mojo emit formatter workflows only (no quality-threshold config).

## Bring Your Own Linter

If a consumer prefers a different linter (e.g. Flake8 instead of Ruff), they:
- Decline the scaffold prompt for that language
- Wire their own linter manually

Scaffold does not re-prompt for a language that was declined. It detects the
decline by absence of any config file with the scaffold marker after the first
run — if the user later adds their own config without the marker, subsequent
syncs will prompt "linter found but no scaffold thresholds — adopt?" which the
user can decline again.

## Sync Integration

`/sync-scaffold` calls `tools/linter-setup/run --detect-only` at the end of a
sync. Detection is owned entirely by the tool — sync does not duplicate the
logic. If unset-up languages are found, sync appends to its output:

```
Detected languages without linter setup: Python, Go
Run /add-linter to configure quality gates for these languages.
```

It does not run `/add-linter` automatically — the user invokes it explicitly.

## Unsupported Languages

If a language is detected but not in the registry (e.g. Swift, Dart, Kotlin),
`/add-linter` reports it as unsupported and skips it silently:

```
Detected: Swift — no scaffold linter registered for this language. Add manually.
```

No prompt, no emission. The user is informed and owns the setup.

## Tool Interface

`tools/linter-setup/run` is a Node.js CLI with two modes:

```
node tools/linter-setup/run --detect-only [--into <path>]
```
Scans `git ls-files` in the target repo, returns a JSON array of detected
languages and their setup state (`none` | `foreign` | `scaffold`). Exit 0.

```
node tools/linter-setup/run [--into <path>]
```
Full mode: detects languages, emits prompts (via stdout for the agent to relay
via `AskUserQuestion`), then emits config + workflow files for confirmed
languages. Returns a JSON result listing what was written, skipped, or declined.

`--into <path>` defaults to the current working directory (the consumer repo).

**Prompting** in the agent context means the agent reads the tool's JSON output
and surfaces the per-language yes/no question to the user via `AskUserQuestion`.
The tool does not use `readline` or interactive stdin.

## File Layout

```
lib/linters/
  js/
    eslint.config.mjs        # ESLint config with scaffold thresholds
    lint-js.yml              # GitHub Actions workflow
  python/
    ruff.toml
    lint-python.yml
  go/
    .golangci.yml
    lint-go.yml
  rust/
    clippy.toml              # (or rustfmt.toml + clippy flags in workflow)
    lint-rust.yml
  ruby/
    .rubocop.yml
    lint-ruby.yml
  shell/
    .shellcheckrc
    lint-shell.yml
  elixir/
    .credo.exs
    lint-elixir.yml
  zig/
    lint-zig.yml             # zig fmt --check only
  mojo/
    lint-mojo.yml            # mojo format --check only

tools/linter-setup/
  run                        # Node.js entry point
  test                       # unit/acceptance tests
  test-integration           # integration tests
```

## Decisions

- **`lib/linters/` + `tools/linter-setup/`** — templates on disk in `lib/`,
  tool reads and emits them. Same pattern as `tools/hoist-skill/` + `skills/`.
- **Marker in config file** — `# scaffold-linter: <lang>` is the sentinel.
  No separate tracking file.
- **Prompted, not automatic** — user confirms per language. Sync suggests,
  `/add-linter` acts.
- **Zig and Mojo** — formatter workflows only; `zwanzig` and `MOJOFuzzer`
  excluded pending verification of tool existence.
- **Mojo + Ruff** — not included; Mojo-specific syntax would cause Ruff to fail
  on non-Python-compatible files.
- **Consumer owns declined languages** — scaffold does not force a linter on any
  language the user has declined or manually configured without the marker.

## Canonical Vocabulary

| Term | Meaning |
|------|---------|
| **linter registry** | The set of supported language→linter mappings in `lib/linters/` |
| **scaffold marker** | `# scaffold-linter: <lang>` comment in an emitted config file |
| **adopt** | Accept scaffold's quality thresholds into an existing linter config |
| **emit** | Write config + workflow files from `lib/linters/<lang>/` into the consumer repo |
| **detected language** | A language whose file extensions are found via `git ls-files` |
| **linter setup** | The one-time prompted process of adding config + workflow for a detected language |
| **detect-only mode** | `--detect-only` flag: scan and report setup state, no emission, no prompts |
| **unsupported language** | A detected language with no registry entry — reported, not prompted |
| **foreign config** | A linter config file present in the consumer repo without the scaffold marker |
