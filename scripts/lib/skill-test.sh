#!/usr/bin/env bash
# skill-test.sh — shared assertions for prompt-skill acceptance tests.
# Source it from a scripts/test-<name>-skill.sh, call the helpers, then `finish`.
# Registration (wrappers, manifest, RESOLVER, frontmatter) is checked by
# scripts/check-resolvable.ts; these tests cover skill content and flow wiring.
PASS=0; FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail(){ echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

# has <file> <extended-regex> <label> — case-insensitive grep assertion.
has() { grep -qiE "$2" "$1" && ok "$3" || fail "$3"; }

# has_cs <file> <extended-regex> <label> — case-sensitive variant.
has_cs() { grep -qE "$2" "$1" && ok "$3" || fail "$3"; }

finish() { echo ""; echo "$PASS passed, $FAIL failed."; [ "$FAIL" -eq 0 ]; }
