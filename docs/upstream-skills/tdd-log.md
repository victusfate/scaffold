# TDD log: upstream-skills

| Slice | Behavior | RED | GREEN | Notes |
|---|---|---|---|---|
| 1 | `/deslop` registered on all harnesses; `/create-pr` Step 6 runs it on title/body | ✅ 0/14 | ✅ 27/27 | Test regex for mode headings corrected (`**Edit (default).**` is the heading, not `**Edit**`); intent unchanged. Added `scripts/lib/skill-test.sh` to `scaffold-internal.txt`. |
| 2 | `/investigate` registered; `/create-pr` Step 2 and `/tdd` route to it | ✅ 0/14 | ✅ 28/28 | Credit line had wrapped across two lines; joined it. |
| 3 | `/qa` registered; `/feature-chain` Phase 3 runs it, Phase 4 reports it | ✅ 0/14 | ✅ 32/32 | Also updated AGENTS.md and README flow descriptions. |
| Refine | Wrapper frontmatter is valid YAML | — | ✅ | `/investigate` and `/qa` descriptions had `": "` inside an unquoted scalar, which is invalid YAML. Rephrased; added `frontmatter_ok` to the shared helper and confirmed it fails on the bad input. |

Gate: `npm test` exit 0 (32 skills, resolver + skills-doc checks green).
Not run here: `npm run lint` / `npm run typecheck` (no `node_modules` in this
container; the change adds no TS/JS), `shellcheck` (not installed; `bash -n` passes).

## Follow-up: /deslop scope (user direction)

| Step | Behavior | RED | GREEN | Notes |
|---|---|---|---|---|
| A | User-facing text gets a full plain-language rewrite; engineering docs get a filler-only pass; steps, commands, constraints, caveats, numbers, rationale, and MUST/NEVER rules are never dropped; terms of art are not slop | ✅ 6 failing | ✅ 38/38 | Description, RESOLVER purpose, and design.md updated. |
| Trial | Fresh-context agent ran `/deslop` on README lines 1–40 and `skills/investigate.md` | — | — | `investigate.md` came back byte-identical (diffed). README: only prose changed, no technical content lost. Found two defects: it flattened a deliberate tagline ("scored, not vibed") and changed em-dash label style in one section only. |
| B | Keep house style; deliberate phrasing beats pattern rules | ✅ 2 failing | ✅ 40/40 | Fixes both trial defects. |
