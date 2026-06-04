# Agent authoring requirements

> Normative spec for any agent adding a callable unit to this repo — a tool, a
> script, or a skill. MUST / SHOULD / MUST NOT are binding. The goal: future
> agents produce units that are discoverable, deterministic, safe, and callable
> the same way every time.
> Voice: short sentences, no em dashes, bullets.

## 0. Principles (apply to everything)

- **Enforce, do not instruct.** Safety and invariants live in code that exits
  non-zero, not in prose a model can skip.
- **Evidence over trust.** A unit's success is provable (exit code, a hash, a
  test run), not asserted.
- **Deterministic core.** Same inputs -> same outputs. No hidden state.
- **Least surface.** Add the smallest unit that does the job. Prefer extending
  an existing unit to adding a new one.

## 1. First decide WHERE it goes

| You want... | Home | Calling surface |
|---|---|---|
| repo-local shell plumbing, run by a human or a skill | `scripts/<name>.{sh,mjs}` | `bash scripts/<name>.sh` / `node scripts/<name>.mjs` |
| a unit agents/MCP/other harnesses call with typed args | `tools/<name>/` | tool descriptor + `run` |
| a distributable engine (npx-runnable, multi-command) | `bin/` | CLI / npx |
| a conversational front door that wraps the above | `skills/<name>.md` (canonical) | the model, via triggers |

- Do **not** rename or merge these homes. They are separated by calling surface.
- Do **not** create an empty home speculatively. Add the unit and its home
  together.
- A skill MUST NOT reimplement logic that belongs in a script/tool/bin. It calls
  it.

### 1a. Repository layout (what each directory holds)

| Directory | Holds | Canonical or generated | Hand-edit? |
|---|---|---|---|
| `skills/<name>.md` | the **canonical** skill/workflow body (the real instructions) | canonical | yes |
| `.claude/skills/<name>/SKILL.md` | Claude form: frontmatter + `@../../../skills/<name>.md` | generated | no |
| `.cursor/rules/<name>.mdc` | Cursor form: frontmatter + `@../../skills/<name>.md` | generated | no |
| `.agents/skills/<name>/SKILL.md`, `.agent/workflows/<name>.md` | other-harness forms | generated | no |
| `.claude/skills/RESOLVER.md` | routing table; every skill MUST be registered | canonical | yes |
| `tools/<name>/` | self-describing, agent/MCP-callable tool (`tool.yaml` + `run`) | canonical | yes |
| `scripts/<name>.{sh,mjs}` | repo-local plumbing, run by a human or a skill | canonical | yes |
| `bin/` | distributable entrypoints (e.g. bootstrap, sync) | canonical | yes |
| `docs/<feature-slug>/` | feature artifacts (`design.md`, `prd.md`, `plan.md`, `tdd-log.md`) | canonical | yes |
| `.claude/session-start/`, `.claude/read-once/`, `.githooks/` | hooks | canonical | yes |

- **Canonical** dirs are the source of truth; you edit them.
- **Generated** dirs are emitted from a canonical source; never hand-edit them
  (see "Generated artifacts" below). Editing a generated file is a defect.

## 2. Tool requirements (`tools/<name>/`)

A tool is the agent/MCP-callable form. It MUST be self-describing.

- **Layout (required):**
  ```
  tools/<name>/
    tool.yaml      # descriptor (schema below)
    run            # executable, +x; reads typed input, writes JSON
    test           # executable; non-zero on failure (acceptance check)
    README.md      # what it does, example call
  ```
- **`tool.yaml` MUST declare:** `kind: tool`, `name` (kebab-case, unique),
  `description` (one line, what+when), `inputs` (typed, with defaults), and a
  `run:` block (`command:` or `endpoint:`). SHOULD declare `emits:` (harness
  targets) and `owned:`/`guarded:` if it writes files.
- **Invocation contract (MUST):**
  - Inputs are typed and validated; reject unknown/malformed input non-zero.
  - Output is structured (JSON) on stdout; logs go to stderr.
  - Exit `0` only on success; non-zero with a clear message otherwise.
  - Idempotent where the operation allows; re-running MUST NOT corrupt state.
  - No network during a "build"/pure step; network only in an explicit
    "resolve"/"fetch" step, and it MUST be declared.
- **Safety (MUST):** honor the owned-file guard — never write a path in `owned`;
  for `guarded` paths, write only if declared markers survive.
- **Tests (MUST):** `test` runs in isolation (a temp dir), asserts behavior, and
  exits non-zero on failure. No test -> not done.
- **Registration (MUST):** add the tool to the capability index (until one
  exists, list it in `tools/README.md`).

### 2a. Engine requirements (`bin/`)

`bin/` holds distributable entrypoints (the bootstrap, the sync, later a packaged
CLI). Distinct from `scripts/` (repo-local plumbing) and `tools/` (typed,
MCP-callable units).

- **MUST** be executable with a correct shebang and run from any CWD (resolve the
  repo root, do not assume `.`).
- **MUST** be safe to run headless (CI, `curl | bash` for a bootstrap) and
  idempotent; re-running MUST NOT corrupt a repo.
- **MUST NOT** silently overwrite consumer-owned files; honor `.scaffold-keep`
  and write `*.scaffold-new` sidecars instead of clobbering (the clobber-safe
  contract).
- **MUST** print what it changed vs skipped, and exit non-zero on real failure.
- **SHOULD** keep flags explicit and opt-in for destructive or workflow-installing
  behavior (e.g. `--run`, `--with-workflow`).
- If published (npx-runnable), the package name and entry MUST be documented in
  `README.md`.

## 3. Script requirements (`scripts/<name>.{sh,mjs}`)

- **MUST** carry a shebang for its interpreter. Bash scripts MUST use
  `#!/usr/bin/env bash` and `set -euo pipefail`. Node scripts MUST use
  `#!/usr/bin/env node` and fail fast (non-zero) on error, no swallowed
  exceptions.
- **MUST** resolve its own root. Bash: `ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`.
  Node: `import path from 'path'; import { fileURLToPath } from 'url';`
  then `const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');`
  (for a script at `scripts/<name>.mjs`; add another `'..'` per extra level).
- **MUST** carry a header comment: what it does, why it exists, usage.
- **MUST** be safe to re-run (idempotent) and report what changed vs was skipped.
- **MUST NOT** `git add -A` (untracked sibling project dirs and caches exist);
  stage explicit paths only.
- **MUST NOT** write owned files; guard them in code (a `PROTECTED`/guard list),
  not a comment.
- **SHOULD** pass `bash -n` and, where reasonable, ship an isolated test.

## 4. Skill requirements (canonical `skills/<name>.md` + generated forms)

A skill has one **canonical body** and N **generated per-harness forms**. Do not
author the per-harness forms by hand.

- **Canonical body (MUST):** `skills/<name>.md` holds the real instructions.
- **Per-harness forms (generated, MUST NOT hand-edit):** each form is frontmatter
  plus an `@` include of the canonical body:
  - `.claude/skills/<name>/SKILL.md` → `@../../../skills/<name>.md`
  - `.cursor/rules/<name>.mdc` → `@../../skills/<name>.md`
  - `.agents/skills/<name>/SKILL.md`, `.agent/workflows/<name>.md`

  > Until the canonical->harness generator ships (capability-sync Phase B), the
  > per-harness forms are created once from the canonical body (frontmatter + an
  > `@` include) and their frontmatter is kept in sync by hand; `check-resolvable.mjs`
  > enforces registration. Once the generator ships, regenerate instead of editing.

- **Frontmatter (MUST):** every emitted form carries a `description` with explicit
  triggers. (Target state: the description lives once on the canonical body as
  frontmatter and the forms are generated from it; until then keep the emitted
  descriptions in sync.)
- **Registration (MUST):** add the skill to `.claude/skills/RESOLVER.md` with its
  invocation regex, canonical path, and purpose. `scripts/check-resolvable.mjs`
  enforces that every skill on disk is registered; it MUST pass.
- **Thin front door (MUST):** a skill interprets intent and calls a
  script/tool/bin. It MUST NOT reimplement the called unit's invariants.
- **Naming:** kebab-case, unique, no collision with built-ins or upstream skills.

## 5. Discoverability

- Names are kebab-case and unique within their home.
- Every callable unit is findable from one index (the capability index / lock),
  not only by reading the tree.

### Generated artifacts (never hand-edit)

- Files under the **per-harness skill form** paths are emitted from a canonical
  source (`skills/<name>.md`, or a tool descriptor) and **MUST NOT** be
  hand-edited: `.claude/skills/<name>/SKILL.md`, `.cursor/rules/<name>.mdc`,
  `.agents/skills/<name>/SKILL.md`, `.agent/workflows/<name>.md`. This does **not**
  cover other files under `.claude/` — `RESOLVER.md`, `settings.json`, and hooks
  (`session-start/`, `read-once/`) are canonical and are hand-edited.
- A change that touches only a generated file without its canonical source is a
  defect and should fail review (and, once wired, CI).
- Adding a harness is adding a generated column; adding a capability is adding a
  canonical row. The two are orthogonal.

## 6. PR checklist (a unit is "done" only if all are true)

- [ ] Lives in the correct home (section 1) and nothing was renamed/merged.
- [ ] Self-describing: tool has `tool.yaml`; script has a header; skill has
      frontmatter+triggers.
- [ ] Typed/validated inputs; structured output; correct exit codes.
- [ ] Honors the owned/guarded file guard in code.
- [ ] Has an isolated test or documented acceptance check that exits non-zero on
      failure, and it was run.
- [ ] Registered in the index (or `tools/README.md` pre-Phase-1).
- [ ] A skill, if added, wraps and does not reimplement.
- [ ] No `git add -A`; explicit paths staged.
- [ ] Skill: canonical `skills/<name>.md` exists; per-harness forms are generated
      (not hand-written) and registered in `RESOLVER.md`; `check-resolvable.mjs`
      passes.
- [ ] No generated per-harness form (`.claude/skills/<name>/`, `.cursor/rules/`,
      `.agents/`, `.agent/`) was hand-edited without its canonical source.
      (`RESOLVER.md`, `settings.json`, and hooks are canonical — editing them is
      expected.)
- [ ] `bin/` entrypoints are clobber-safe and run from any CWD.
