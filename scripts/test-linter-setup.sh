#!/usr/bin/env bash
set -euo pipefail
PASS=0; FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

LINTERS_DIR="lib/linters"

[ -d "$LINTERS_DIR" ] || { echo "MISSING: $LINTERS_DIR"; exit 1; }

# Each language has a workflow file with pull_request trigger
LANGUAGES="js ts python go rust ruby shell elixir zig mojo"
for lang in $LANGUAGES; do
  dir="$LINTERS_DIR/$lang"
  [ -d "$dir" ] && ok "$lang template dir exists" || fail "$lang template dir missing"

  # Workflow file has pull_request trigger
  workflow=$(ls "$dir"/lint-*.yml 2>/dev/null | head -1)
  if [ -n "$workflow" ]; then
    grep -q 'pull_request' "$workflow" \
      && ok "$lang workflow has pull_request trigger" \
      || fail "$lang workflow missing pull_request trigger"
    # Workflow has scaffold marker
    grep -q "scaffold-linter: $lang" "$workflow" \
      && ok "$lang workflow has scaffold marker" \
      || fail "$lang workflow missing scaffold marker"
  else
    fail "$lang workflow file missing"
  fi
done

# Metrics languages have config files with scaffold marker and at least one threshold
METRICS_LANGS="js ts python go rust ruby elixir"
for lang in $METRICS_LANGS; do
  dir="$LINTERS_DIR/$lang"
  config=$(ls "$dir"/*.toml "$dir"/*.yml "$dir"/*.mjs "$dir"/.*.yml "$dir"/.*.exs "$dir"/.*rc "$dir"/.*.exs 2>/dev/null \
    | grep -v 'lint-' | head -1 || true)
  if [ -n "$config" ]; then
    grep -q "scaffold-linter: $lang" "$config" \
      && ok "$lang config has scaffold marker" \
      || fail "$lang config missing scaffold marker"
    # At least one rubric threshold present
    grep -qE '(max.lines|max.params|complexity|max.complexity|max.args|max.arity|funlen|too.many|MethodLength|CyclomaticComplexity|ParameterLists|max-complexity|max_complexity|max_arity)' "$config" \
      && ok "$lang config has at least one rubric threshold" \
      || fail "$lang config missing rubric thresholds"
  else
    fail "$lang config file missing"
  fi
done

# Zig and Mojo are format-only — no config file required
for lang in zig mojo; do
  workflow="$LINTERS_DIR/$lang/lint-$lang.yml"
  [ -f "$workflow" ] \
    && ok "$lang format-only workflow present" \
    || fail "$lang format-only workflow missing"
done

echo ""
echo "$PASS passed, $FAIL failed."
[ "$FAIL" -eq 0 ]
