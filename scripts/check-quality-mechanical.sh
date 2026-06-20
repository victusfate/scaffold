#!/usr/bin/env bash
# check-quality-mechanical.sh — mechanical code quality checks.
# Usage: check-quality-mechanical.sh [file ...] (defaults to git changed files)
# Exits non-zero if any violation is found. All violations include filename:line citations.
set -euo pipefail

MAX_LINES=500
VIOLATIONS=0

emit() { echo "$1"; VIOLATIONS=$((VIOLATIONS + 1)); }

check_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  local ext="${file##*.}"

  # File length
  local count
  count=$(wc -l < "$file")
  if [ "$count" -gt "$MAX_LINES" ]; then
    emit "${file}:${MAX_LINES} [Readability/major] file is ${count} lines — exceeds ${MAX_LINES}-line limit; extract modules"
  fi

  # Magic numbers/strings: bare numeric literals not assigned to a named constant.
  # Matches: standalone integers ≥2 digits not in a `const NAME = N` assignment and not
  # inside a named-constant context. Skips 0 and 1 (universally understood), line-number
  # refs, and array index accesses.
  local lineno=0 in_docstring=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    # Python triple-quoted docstrings: count """ per line; odd count toggles in/out.
    # Lines inside a docstring are not code and must not be scanned for magic numbers.
    # Use bash string replacement — no subprocesses, safe under set -euo pipefail.
    if [ "$ext" = "py" ]; then
      local stripped="${line//\"\"\"/}"
      local tq=$(( (${#line} - ${#stripped}) / 3 ))
      [ $(( tq % 2 )) -eq 1 ] && in_docstring=$(( 1 - in_docstring ))
      [ "$in_docstring" -eq 1 ] && continue
    fi
    # Skip comment lines and empty lines
    [[ "$line" =~ ^[[:space:]]*(//|#|\*|/\*) ]] && continue
    [[ -z "${line// }" ]] && continue
    # Skip JS/TS const/let/var/readonly NAME = NUMBER (named constant definition)
    [[ "$line" =~ ^[[:space:]]*(const|let|var|readonly)[[:space:]]+[A-Z_]+ ]] && continue
    # Skip shell/Python UPPER_CASE = <literal> — constant definitions in both languages.
    # Leading underscores (Python private constants like _PT_PER_INCH) are included.
    # Tuple form (A, B = 1, 2) is also covered. Excludes command substitutions ($(...)).
    [[ "$line" =~ ^[[:space:]]*_*[A-Z][A-Z0-9_]*([[:space:]]*,[[:space:]]*_*[A-Z][A-Z0-9_]*)*[[:space:]]*=[[:space:]]*[0-9] ]] && continue
    # Numbers inside string literals are data (e.g. a grep pattern "Score.*10"),
    # not magic numbers — strip quoted substrings before the scan.
    local scan
    scan=$(printf '%s' "$line" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
    # Flag bare integers ≥2 digits that are not array indices or lone 0/1
    if echo "$scan" | grep -qE '[^a-zA-Z0-9_."\x27][0-9]{2,}[^a-zA-Z0-9_.]'; then
      emit "${file}:${lineno} [Readability/minor] magic number — extract to a named constant"
    fi
  done < "$file"

  # Commented-out code: two or more consecutive lines starting with // or #
  # that look like code (contain common code tokens).
  local prev_was_comment=0
  lineno=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    if echo "$line" | grep -qE '^[[:space:]]*(//|#)[[:space:]]*(function|const|let|var|return|if|for|while|class|import|export|})'; then
      if [ "$prev_was_comment" -eq 1 ]; then
        emit "${file}:${lineno} [Clarity/minor] commented-out code block — delete dead code instead of archiving inline"
      fi
      prev_was_comment=1
    else
      prev_was_comment=0
    fi
  done < "$file"
}

# Resolve files: args or git changed files
if [ $# -gt 0 ]; then
  FILES=("$@")
else
  mapfile -t FILES < <(git diff main...HEAD --name-only 2>/dev/null \
    | grep -E '\.(js|mjs|ts|tsx|sh|py|rb|go)$' \
    || true)
fi

for f in "${FILES[@]}"; do
  check_file "$f"
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "${VIOLATIONS} mechanical violation(s) found. Fix before creating a PR."
  exit 1
fi

echo "✓ mechanical checks passed."
