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

  # Generated / machine-authored files are skipped whole — the same convention
  # ESLint and Prettier honor. A mechanical CODE-quality check has nothing to say
  # about machine-produced OUTPUT: e.g. a procedural geometry catalog is tens of
  # thousands of lines of raw vertex-coordinate arrays where every number is a
  # coordinate and "extract to a named constant" is meaningless. Mark such a file
  # with `@generated` in its first 5 lines. Use ONLY for genuinely generated/data
  # files — never to silence a lint on hand-maintained logic.
  if head -5 "$file" 2>/dev/null | grep -q '@generated'; then
    return 0
  fi

  # File length
  local count
  count=$(wc -l < "$file")
  if [ "$count" -gt "$MAX_LINES" ]; then
    emit "${file}:${MAX_LINES} [Readability/major] file is ${count} lines — exceeds ${MAX_LINES}-line limit; extract modules"
  fi

  # Magic numbers/strings: bare numeric literals not assigned to a named constant.
  #
  # The goal is to catch hidden thresholds — numbers whose significance requires
  # explanation ("why 1200?", "1200 what?"). The check is NOT trying to catch
  # every bare digit: return values, exit codes, and test assertions are excluded
  # because they're protocol-defined or specs, not hidden design decisions.
  #
  # Exclusions applied before the scan (in order):
  #   1. Test files — assertion literals are specs, not thresholds.
  #   2. `quality-ok: magic-number — <reason>` pragma on the preceding line.
  #   3. `return`/`exit` statements — values are protocol-defined (HTTP codes, etc.).
  #   4. Named constant definitions — `const NAME = N`, `UPPER_CASE = N`, etc.
  #   5. Numbers inside string literals — stripped before the scan.
  local base="${file##*/}"
  local is_test=0
  [[ "$base" == *test* || "$base" == *spec* || "$base" == test-* ]] && is_test=1

  local lineno=0 in_docstring=0 prev_quality_ok=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))

    # Pragma detection — must precede the generic comment-skip below.
    # `quality-ok: magic-number` on the line immediately above suppresses the
    # check for the next code line. A reason after " — " is required by convention
    # (and enforced at review time) but not parsed here — the keyword is the gate.
    if [[ "$line" =~ ^[[:space:]]*(#|//)[[:space:]]*quality-ok:[[:space:]]*magic-number ]]; then
      prev_quality_ok=1
      continue
    fi

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

    # Test files, pragma, and return/exit are all checked together here so the
    # control flow is a single skip decision before the expensive sed+grep.
    if [ "$is_test" -eq 1 ] || [ "$prev_quality_ok" -eq 1 ]; then
      prev_quality_ok=0; continue
    fi
    # return/exit values are protocol-defined (HTTP status codes, shell exit codes).
    # `return 200` is self-documenting; naming it HTTP_OK would add noise, not clarity.
    [[ "$line" =~ ^[[:space:]]*(return|exit)[[:space:]] ]] && { prev_quality_ok=0; continue; }

    # Numbers inside string literals are data (e.g. a grep pattern "Score.*10"),
    # not magic numbers — strip quoted substrings before the scan. The sed only
    # spawns when the line actually contains a quote, so most lines skip it.
    local scan="$line"
    if [[ "$line" == *\'* || "$line" == *\"* ]]; then
      scan=$(printf '%s' "$line" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
    fi
    # Strip parseInt/parseFloat radix and .toString() radix — explicit base
    # specs, not hidden thresholds. Guarded so the sed only spawns on the rare
    # line that uses one.
    if [[ "$scan" == *parseInt* || "$scan" == *.toString* ]]; then
      scan=$(printf '%s' "$scan" | sed 's/parseInt([^,]*,[^)]*)/parseInt(X)/g; s/\.toString([^)]*)/\.toString(X)/g')
    fi
    # Flag bare integers ≥2 digits that are not array indices or lone 0/1.
    # Bash ERE in [[ =~ ]] supports {2,}; the regex lives in a variable so it
    # is matched as a pattern (no subprocess vs the old echo|grep).
    local magic_re='[^a-zA-Z0-9_."'\''][0-9]{2,}[^a-zA-Z0-9_.]'
    if [[ "$scan" =~ $magic_re ]]; then
      emit "${file}:${lineno} [Readability/minor] magic number — extract to a named constant (or use quality-ok: magic-number pragma if the value is self-documenting)"
    fi
    prev_quality_ok=0
  done < "$file"

  # Commented-out code: two or more consecutive lines starting with // or #
  # that look like code (contain common code tokens).
  local prev_was_comment=0
  lineno=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))
    if [[ "$line" =~ ^[[:space:]]*(//|#)[[:space:]]*(function|const|let|var|return|if|for|while|class|import|export|}) ]]; then
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
