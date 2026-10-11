#!/usr/bin/env bash
# Acceptance test for the /upstream skill (consumer → scaffold PR → merge → sync back).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. scripts/lib/skill-test.sh
S=skills/upstream.md

[ -f "$S" ] || { fail "$S missing"; finish; exit 1; }

has "$S" 'generic|universal'                     "separates universal from project-specific"
has "$S" 'project-specific'                      "project-specific half stays in the consumer"
has "$S" 'worktree add'                          "works in a clean scaffold worktree"
has "$S" 'Do not switch branches'                "never disturbs the scaffold main checkout"
has "$S" 'scaffold-files\.txt'                   "new files go in the sync manifest"
has "$S" 'RESOLVER'                              "new skills get a RESOLVER row"
has "$S" 'update-skills-doc'                     "regenerates docs/skills.md"
has "$S" 'npm test'                              "runs scaffold gates locally"
has "$S" 'not a pass'                          "a skipped required check is not a pass"
has "$S" 'sync-scaffold'                         "syncs back with /sync-scaffold"
has "$S" 'scaffold-keep'                         "respects .scaffold-keep on sync"
has "$S" 'authoriz'                              "states the merge authorization rule"
has "$S" 'secrets|personal data'                 "never upstreams secrets or personal data"
has "$S" 'hoist-skill'                           "contrasts with /hoist-skill"
for f in .claude/skills/upstream/SKILL.md .agents/skills/upstream/SKILL.md .agent/workflows/upstream.md .cursor/rules/upstream.mdc; do
  [ -f "$f" ] && ok "$f wrapper present" || fail "$f wrapper missing"
  has .github/scaffold-files.txt "^${f//./\\.}\$" "$f in sync manifest"
done
has .github/scaffold-files.txt '^skills/upstream\.md$' "skills/upstream.md in sync manifest"
has .claude/skills/RESOLVER.md '^\| upstream' "RESOLVER row present"
has AGENTS.md '## Owner status reports' "AGENTS.md owner status report rule present"

finish
