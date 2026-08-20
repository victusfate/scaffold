# Pi Migration: Skills Compatibility Analysis

Goal: update the 25 scaffold skills so they work fluently with pi (terminal agent)
and pi-web (browser-based agent) without breaking Claude Code support.

---

## Taxonomy

| Status | Meaning |
|--------|---------|
| 🔴 Hard break | References tools, paths, or binaries that don't exist in pi |
| 🟡 Cross-reference | Mentions other skills as Claude slash commands (`/tdd`, `/code-refiner`, etc.) — still functional but the load path differs in pi |
| 🟢 Works as-is | No Claude-specific references; only relative paths and `gh` CLI |

---

## Per-skill breakdown

### 🔴 create-pr

**Issue:** Uses MCP tools (`mcp__github__create_pull_request`, `mcp__github__subscribe_pr_activity`,
`mcp__github__…get_check_runs`) that don't exist outside Claude Code.

**Fix:** Replace all `mcp__github__*` calls with `gh` CLI equivalents (`gh pr create`, `gh pr checks`).
`gh` is already available in both harnesses. Subscribe step becomes a manual note (pi has no PR-activity
webhook without an extension).

### 🔴 statusline

**Issue:** Installs a script to `~/.claude/statusline.sh` and merges a `statusLine` key into
`~/.claude/settings.json`. pi has a different config path (`~/.pi/agent/settings.json`) and no
analog to Claude Code's `statusLine` feature.

**Fix:** Repoint to `~/.pi/agent/settings.json`. The "status line" feature itself doesn't exist in pi,
so this skill should document the gap: it can toggle the setting key, but pi won't render it until a
companion extension is written.

### 🔴 voice-chat

**Issue:** Spawns `claude -p` as the LLM subprocess.

**Fix:** Generalize the subprocess call to `pi -p` when running under pi (check `PI_CODING_AGENT` env var),
`claude -p` otherwise. Document both paths.

### 🔴 hoist-skill

**Issue:** References `.claude/skills/` in manifest examples and output paths.

**Fix:** Keep the tool's manifest format harness-agnostic but update examples and documentation to show
both `.claude/skills/` and `.agents/skills/` output paths.

### 🔴 skillify

**Issue:** Registers the new skill into `.claude/skills/RESOLVER.md`. pi has no resolver — skills
discover by directory presence.

**Fix:** Detect harness: if running under pi (`PI_CODING_AGENT=true` or presence of `.pi/`), skip
resolver registration and instead place the skill in `.agents/skills/<slug>/SKILL.md`. Under Claude Code,
keep the existing resolver behavior.

---

### 🟡 Cross-reference skills (19 total)

These skills reference each other using Claude Code slash-command syntax (`/tdd`, `/code-refiner`,
`/feature-chain`, etc.). In pi, skills are loaded via `/skill:name` or by the agent reading SKILL.md
directly. The agent won't know that "run `/code-refiner`" means "read and execute
`.agents/skills/code-refiner/SKILL.md`".

| Skill | References other skills as |
|---|---|
| feature-chain | `/grill-with-docs`, `/design-review`, `/to-prd`, `/tdd`, `/code-refiner` |
| tdd | `/code-refiner` |
| code-refiner | `/simplify`, `/validate`, `/audit` |
| prune | references chain skills |
| audit | `/simplify` |
| ponytail | `/simplify` |
| design-review | (part of chain) |
| grill-with-docs | `/design-review`, `/to-prd` |
| to-prd | /tdd |
| queue | `/feature-chain` |
| pause | `/resume` |
| resume | `/pause` |
| hoist-skill | references various by path |
| simplify | references rubric |
| validate | references rubric |
| create-pr | `/simplify` |
| council | (standalone) |
| diagram | (standalone) |
| frontend-design | (standalone) |
| protect-branch | (standalone) |

**Fix:** For each cross-reference, add a pi-aware preamble: "In pi, read and follow
`.agents/skills/<name>/SKILL.md`. In Claude Code, invoke `/<name>`." Keep the existing
slash-command as the Claude Code path.

---

### 🟢 Works as-is (10 skills)

No Claude-specific references. Use relative paths and `gh` CLI. Portable as-is:

- add-linter
- audit
- code-refiner
- council
- design-review
- diagram
- frontend-design
- protect-branch
- simplify
- to-prd

Also: ponytail, sync-scaffold, validate, prune, queue (already green above but noted for completeness).

---

## Approach options

### A) Minimal diff — fix only what's broken (targeted edits)

- 5 hard-break skills get harness-conditional logic
- 19 cross-reference skills get a one-line preamble about pi load path
- Zero structural changes. Claude Code behavior unchanged.

**Risk:** Low. ~40-50 small edits, each skill file gains 2-6 lines.

### B) Full pi-native rewrite (extension + flattened skills)

- Build a pi extension that registers each skill as a tool
- Skills become inline instructions inside the extension
- No file-system skill loading needed

**Risk:** High. Rewrites 25 skills into a new format. Claude Code support would need porting back.

---

## Status: Option A applied (2025-08-20)

All 25 skills are now dual-harness compatible. Summary of changes:

### Hard breaks fixed (5 skills)
| Skill | Fix |
|-------|-----|
| create-pr | Replaced `mcp__github__*` calls with `gh` CLI + harness-conditional notes (Step 7, Step 8, merge verification) |
| statusline | Added harness note: pi has no native `statusLine` key; this skill is Claude Code-only until a pi extension companion is written |
| voice-chat | Generalized `claude -p` → `<agent> -p` with runtime detection (`PI_CODING_AGENT`); updated subscription language |
| hoist-skill | Added harness note explaining `--harness claude` vs `--harness antigravity` output paths |
| skillify | Added harness note: pi discovers skills by directory presence, no RESOLVER.md needed; updated registration rule |

### Cross-reference notes added (14 skills)
Each skill that references other scaffold skills via `/name` notation now has a `Multi-harness` preamble explaining the pi load path (read `.agents/skills/<name>/SKILL.md`). Affected: feature-chain, tdd, code-refiner, prune, grill-with-docs, to-prd, pause, resume, queue, ponytail, add-linter, audit, simplify, validate.

### Unchanged (6 skills)
Council, design-review, diagram, frontend-design, protect-branch, sync-scaffold — no Claude-specific references.

### Inline `claude -c` → `claude -c` (or `pi -c`) updates
- pause.md, resume.md: session-resume references now mention both harnesses.