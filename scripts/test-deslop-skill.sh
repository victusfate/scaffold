#!/usr/bin/env bash
# Acceptance test for the /deslop prose-check skill and its /create-pr wiring.
set -uo pipefail
cd "$(dirname "$0")/.."
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
has skills/create-pr.md '/deslop'               "create-pr runs /deslop on title and body"

finish
