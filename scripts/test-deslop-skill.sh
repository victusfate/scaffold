#!/usr/bin/env bash
# Acceptance test for the /deslop prose-check skill and its /create-pr wiring.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. scripts/lib/skill-test.sh
S=skills/deslop.md

assert_registered deslop
[ -f "$S" ] || { finish; exit 1; }

has "$S" 'petergyang/no-ai-slop.*MIT'          "credits upstream (MIT)"
has "$S" '\*\*Edit'                         "edit mode described"
has "$S" '\*\*Detect'                       "detect mode described"
has "$S" 'preserve.*voice'                      "voice-preservation rule"
has "$S" 'invent'                               "no invented claims rule"
has "$S" 'delve'                                "banned-word list present"
has "$S" 'Binary contrasts'                     "pattern: binary contrasts"
has "$S" 'Throat-clearing'                      "pattern: throat-clearing"
has "$S" 'honest'                               "covers AGENTS.md self-label rule"
has "$S" 'code blocks|identifiers'              "leaves code and identifiers alone"
has "$S" 'Self-check'                           "self-check pass after editing"
has "$S" 'What changed'                         "edit output lists what changed"
has "$S" 'user-facing'                          "full rewrite targets user-facing content"
has "$S" 'engineering (reference|docs)'         "engineering docs get a restricted pass"
has "$S" 'never (delete|remove|drop).*(step|command|constraint|caveat)' "never drops technical content"
has "$S" 'MUST|NEVER'                           "keeps normative rules intact"
has "$S" 'terms? of art'                        "technical terms of art are not slop"
has "$S" 'plain (language|words)'               "plain-language guidance for user-facing text"
has "$S" 'nothing (was )?lost|still present'    "self-check confirms no technical content lost"
has "$S" 'house style'                          "keeps the document's existing formatting conventions"
has "$S" 'deliberate.*(phrase|line|tagline)'    "voice beats pattern rules for deliberate phrasing"
has "$S" "project's own (key )?terms"            "never strips the project's own key terms"
has skills/create-pr.md '/deslop'               "create-pr runs /deslop on title and body"

finish
