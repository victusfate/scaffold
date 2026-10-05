#!/usr/bin/env bash
# Acceptance test for the /qa live-app QA skill and its feature-chain wiring.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. scripts/lib/skill-test.sh
S=skills/qa.md

assert_registered qa
[ -f "$S" ] || { finish; exit 1; }

has "$S" 'garrytan/gstack.*MIT'                 "credits upstream (MIT)"
has "$S" 'browser'                              "surface: browser"
has "$S" 'API'                                  "surface: HTTP API"
has "$S" 'CLI'                                  "surface: CLI"
has "$S" 'git status --porcelain'               "requires a clean working tree"
has "$S" 'diff-aware|git diff'                  "scopes probes to the diff by default"
has "$S" 'quick.*standard.*exhaustive'          "fix tiers"
has "$S" 'console error'                        "browser probe captures console errors"
has "$S" 'screenshot'                           "browser evidence is screenshots"
has "$S" 'regression test'                      "regression test before each fix"
has "$S" '/investigate'                         "diagnoses with /investigate"
has "$S" 're-run|re-verify'                     "re-verifies after each fix"
has "$S" 'two reverts'                          "self-regulation stop rule"
has "$S" 'credentials'                          "never asks for real credentials"
has "$S" 'blocked'                              "unreachable surface is reported blocked, not passed"
has "$S" 'QA found'                             "one-line summary for PR body"
has skills/feature-chain.md '/qa'               "feature-chain runs /qa"
has skills/feature-chain.md 'QA'                "feature-chain Phase 4 summary reports QA"

finish
