# Skills

> Generated from [`.claude/skills/RESOLVER.md`](../.claude/skills/RESOLVER.md) by
> `scripts/update-skills-doc.ts`. Run `node scripts/update-skills-doc.ts` after
> changing skills. Do not edit the generated blocks below by hand.

<!-- BEGIN_SKILLS_INVOCATION -->
Skills can be invoked individually: `/feature-chain`, `/grill-with-docs`, `/to-prd`, `/tdd`, `/design-review`, `/code-quality-review`, `/skillify`, `/sync-scaffold`, `/create-pr`, `/code-review`, `/simplify`, `/prune`, `/pause`, `/resume`, `/hoist-skill`, `/protect-branch`, `/frontend-design`, `/audit`, `/add-linter`.
<!-- END_SKILLS_INVOCATION -->

## Structure

<!-- BEGIN_SKILLS_STRUCTURE -->
```
AGENTS.md                        # agent instructions — single source of truth
CLAUDE.md                        # imports AGENTS.md (@AGENTS.md)
GEMINI.md                        # references AGENTS.md
package.json                     # npm entry (bin/sync) — name, version, engines, test scripts
docs/
  agent-authoring-requirements.md  # normative spec for tools, scripts, skills, bin
  skills.md                        # this file — generated skill list + repo layout
bin/
  bootstrap.sh                   # one-time setup for downstream repos
  sync-from-scaffold.sh          # pull scaffold updates into a downstream repo
  sync                           # npx entrypoint → tools/sync/run.ts
  install-skills.sh              # copy skills into a global dir (e.g. ~/.claude/skills)
  globalize-skill.sh             # promote one skill into a global dir, imports inlined
  repo-bound-skills.txt          # shared guard list for the two installers
tools/
  README.md                      # capability index (spec §2 registration)
  lib/
    safe-write.ts                # shared clobber-safe write engine (sidecars, .scaffold-keep)
  hoist-skill/                   # tool: emit skills into a consumer repo (tool.yaml, run, hoist.ts, test)
  sync/                          # tool: npx consumer sync (tool.yaml, run.ts, policy.ts, promote.ts, test)
.claude/
  skills/
    RESOLVER.md                   # central routing table — skill → regex → path
    feature-chain/SKILL.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs/SKILL.md      # Design Q&A → design.md + canonical vocabulary
    to-prd/SKILL.md               # Synthesize context + codebase → prd.md
    tdd/SKILL.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review/SKILL.md        # Structural review of design.md
    code-quality-review/SKILL.md  # Structural review of implementation
    skillify/SKILL.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold/SKILL.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr/SKILL.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review/SKILL.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify/SKILL.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune/SKILL.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause/SKILL.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume/SKILL.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
    hoist-skill/SKILL.md          # Hoist scaffold capabilities into a consumer repo in the target harness format
    protect-branch/SKILL.md       # Open GitHub branch protection settings for the current repo and show a targeted configuration checklist
    frontend-design/SKILL.md      # Create distinctive, production-grade frontend interfaces that avoid generic AI aesthetics
    audit/SKILL.md                # Score source files ranked worst-first across all four rubric dimensions with cited violations
    add-linter/SKILL.md           # Add linter configs and GitHub Actions workflows for languages detected in the current repo
  session-start/
    hook.sh                      # SessionStart hook: fetches origin/main, warns if branch is behind
  read-once/
    hook.sh                      # PreToolUse hook: skips redundant file reads
    compact.sh                   # PostCompact hook: clears read cache after compaction
  settings.json                  # hook wiring (SessionStart, PreToolUse, PostCompact)
.cursor/
  rules/
    agents.mdc               # thin pointer to AGENTS.md
    feature-chain.mdc        # mirrors feature-chain for Cursor
    grill-with-docs.mdc      # mirrors grill-with-docs for Cursor
    to-prd.mdc               # mirrors to-prd for Cursor
    tdd.mdc                  # mirrors tdd for Cursor
    design-review.mdc        # mirrors design-review for Cursor
    code-quality-review.mdc  # mirrors code-quality-review for Cursor
    skillify.mdc             # mirrors skillify for Cursor
    sync-scaffold.mdc        # mirrors sync-scaffold for Cursor
    create-pr.mdc            # mirrors create-pr for Cursor
    code-review.mdc          # mirrors code-review for Cursor
    simplify.mdc             # mirrors simplify for Cursor
    prune.mdc                # mirrors prune for Cursor
    pause.mdc                # mirrors pause for Cursor
    resume.mdc               # mirrors resume for Cursor
    hoist-skill.mdc          # mirrors hoist-skill for Cursor
    protect-branch.mdc       # mirrors protect-branch for Cursor
    frontend-design.mdc      # mirrors frontend-design for Cursor
    audit.mdc                # mirrors audit for Cursor
    add-linter.mdc           # mirrors add-linter for Cursor
.agents/
  skills/
    feature-chain/SKILL.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs/SKILL.md      # Design Q&A → design.md + canonical vocabulary
    to-prd/SKILL.md               # Synthesize context + codebase → prd.md
    tdd/SKILL.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review/SKILL.md        # Structural review of design.md
    code-quality-review/SKILL.md  # Structural review of implementation
    skillify/SKILL.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold/SKILL.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr/SKILL.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review/SKILL.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify/SKILL.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune/SKILL.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause/SKILL.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume/SKILL.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
    hoist-skill/SKILL.md          # Hoist scaffold capabilities into a consumer repo in the target harness format
    protect-branch/SKILL.md       # Open GitHub branch protection settings for the current repo and show a targeted configuration checklist
    frontend-design/SKILL.md      # Create distinctive, production-grade frontend interfaces that avoid generic AI aesthetics
    audit/SKILL.md                # Score source files ranked worst-first across all four rubric dimensions with cited violations
    add-linter/SKILL.md           # Add linter configs and GitHub Actions workflows for languages detected in the current repo
.agent/
  rules/
    agents.md               # thin pointer to AGENTS.md (always-on)
  workflows/
    feature-chain.md        # Orchestrate design → PRD → TDD → review end to end
    grill-with-docs.md      # Design Q&A → design.md + canonical vocabulary
    to-prd.md               # Synthesize context + codebase → prd.md
    tdd.md                  # Vertical-slice TDD → plan.md + tdd-log.md
    design-review.md        # Structural review of design.md
    code-quality-review.md  # Structural review of implementation
    skillify.md             # Capture a completed session as a reusable skill + PR to scaffold
    sync-scaffold.md        # Bootstrap scaffold into a repo or sync an existing one from upstream
    create-pr.md            # Create a PR for the current branch and immediately subscribe to its activity
    code-review.md          # Review current diff for correctness bugs and quality issues at a configurable effort level
    simplify.md             # Apply reuse, simplification, efficiency, and altitude cleanups to changed code
    prune.md                # Run all quality review skills and funnel findings into design→PRD→TDD→PR
    pause.md                # Checkpoint the session into git — write a handoff, commit work in flight, and push so any device can resume
    resume.md               # Reload a checkpointed session from the pushed handoff and continue from its next steps, cold or cross-device
    hoist-skill.md          # Hoist scaffold capabilities into a consumer repo in the target harness format
    protect-branch.md       # Open GitHub branch protection settings for the current repo and show a targeted configuration checklist
    frontend-design.md      # Create distinctive, production-grade frontend interfaces that avoid generic AI aesthetics
    audit.md                # Score source files ranked worst-first across all four rubric dimensions with cited violations
    add-linter.md           # Add linter configs and GitHub Actions workflows for languages detected in the current repo
scripts/
  check-resolvable.ts            # RESOLVER linter (reachability/ambiguity/DRY/MECE/parity/sync)
  update-skills-doc.ts           # regenerate docs/skills.md skill sections from RESOLVER.md
  compute-bump.ts                # conventional-commit version bump (used by the create-pr skill)
  test-sync.sh                   # isolated tests for bin/sync-from-scaffold.sh
  test-bootstrap.sh              # isolated tests for bin/bootstrap.sh
.githooks/
  pre-commit                     # runs the linter and skills-doc freshness check — enable via core.hooksPath
.github/
  scaffold-files.txt             # manifest of files managed by scaffold
  workflows/
    ci.yml                       # verify (npm test) + integration jobs on PRs
    release.yml                  # tag v<version> on merge to main
    sync-scaffold.yml            # manual workflow to sync updates via PR
.claudeignore                    # excludes build artifacts from Claude's context
```
<!-- END_SKILLS_STRUCTURE -->
