#!/usr/bin/env bash
# Acceptance test for the /investigate root-cause skill and its create-pr / tdd wiring.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. scripts/lib/skill-test.sh
S=skills/investigate.md

assert_registered investigate
[ -f "$S" ] || { finish; exit 1; }

has "$S" 'obra/superpowers.*MIT'                 "credits upstream (MIT)"
has "$S" 'no fix without (a )?root cause'        "no-fix-before-root-cause law"
has "$S" 'Phase 1.*Reproduce'                    "phase 1: reproduce"
has "$S" 'Phase 2.*(Compare|Pattern)'            "phase 2: compare against working code"
has "$S" 'Phase 3.*Hypothes'                     "phase 3: single hypothesis"
has "$S" 'Phase 4.*Fix'                          "phase 4: fix"
has "$S" 'one (variable|change) at a time'       "test one change at a time"
has "$S" 'failing test'                          "failing regression test before fix"
has "$S" 'three (failed )?fixes|3 failed fixes'  "stop after three failed fixes"
has "$S" 'architecture'                          "escalate to architecture question"
has "$S" 'evidence'                              "evidence-before-claims gate"
has "$S" 'flak'                                  "flake is not a root cause"
has skills/create-pr.md '/investigate'           "create-pr Step 2 diagnoses with /investigate"
has skills/tdd.md '/investigate'                 "tdd routes unexpected failures to /investigate"

finish
