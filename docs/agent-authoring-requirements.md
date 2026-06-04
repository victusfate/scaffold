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
| repo-local shell plumbing, run by a human or a skill | `scripts/<name>.sh` | `bash scripts/<name>.sh` |
| a unit agents/MCP/other harnesses call with typed args | `tools/<name>/` | tool descriptor + `run` |
| a distributable engine (npx-runnable, multi-command) | `bin/` | CLI / npx |
| a conversational front door that wraps the above | `.claude/skills/<name>/SKILL.md` | the model, via triggers |

- Do **not** rename or merge these homes. They are separated by calling surface.
- Do **not** create an empty home speculatively. Add the unit and its home
  together.
- A skill MUST NOT reimplement logic that belongs in a script/tool/bin. It calls
  it.

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

## 3. Script requirements (`scripts/<name>.sh`)

- **MUST** start with `#!/usr/bin/env bash` and `set -euo pipefail`.
- **MUST** resolve its own root: `ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`.
- **MUST** carry a header comment: what it does, why it exists, usage.
- **MUST** be safe to re-run (idempotent) and report what changed vs was skipped.
- **MUST NOT** `git add -A` (untracked sibling project dirs and caches exist);
  stage explicit paths only.
- **MUST NOT** write owned files; guard them in code (a `PROTECTED`/guard list),
  not a comment.
- **SHOULD** pass `bash -n` and, where reasonable, ship an isolated test.

## 4. Skill requirements (`.claude/skills/<name>/SKILL.md`)

- **MUST** have frontmatter: `name` and a `description` with explicit triggers.
- **MUST** be a thin front door: interpret intent, call the script/tool/bin,
  report output. It MUST NOT duplicate the unit's invariants.
- **MUST** state the critical rules it enforces (e.g. stay on branch, stage
  explicit paths) and defer the hard guarantees to the called code.
- SHOULD have a unique name that does not collide with built-ins or upstream
  skills.

## 5. Discoverability

- Names are kebab-case and unique within their home.
- Every callable unit is findable from one index (the capability index / lock),
  not only by reading the tree.

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
