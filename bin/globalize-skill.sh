#!/usr/bin/env bash
# globalize-skill.sh — promote ONE skill from any source repo into the global
# skills dir as a SELF-CONTAINED skill (any @import is inlined).
#
# Why this exists: scaffold skills are thin stubs whose body lives in
# skills/<name>.md and is pulled in with `@../../../skills/<name>.md`. Copy a
# stub flat into ~/.claude/skills and the import dangles — the skill is broken
# (the global cleanup removed 11 such stubs). This script resolves the import
# and writes a single self-contained SKILL.md, so the skill actually works
# anywhere it's dropped.
#
# Source-agnostic. Handles both shapes:
#   - scaffold stub (frontmatter + @import)   -> inlines the canonical body
#   - victusama self-contained (full body)    -> copies verbatim
#
# This is the LOCAL convenience path (~/.claude/skills). A cloud/mobile sandbox
# never sees ~/.claude/skills — for those, commit the skill in the repo's own
# .claude/skills/ (use bin/sync-from-scaffold.sh inside that project).
#
# Usage:
#   bash bin/globalize-skill.sh <name> [--from <repo>] [--target <dir>] [--force] [--dry-run]
#
#   <name>        skill directory name (e.g. audit, create-pr)
#   --from <repo> source repo root. Default: this scaffold checkout.
#   --target <d>  where it lands. Default: ~/.claude/skills
#   --force       override the repo-bound / built-in-collision guards
#   --dry-run     print the resolved skill, write nothing
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

NAME=""; REPO="$DEFAULT_REPO"; TARGET="${HOME}/.claude/skills"
FORCE=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from)    REPO="$2"; shift 2 ;;
    --target)  TARGET="$2"; shift 2 ;;
    --force)   FORCE=1; shift ;;
    --dry-run|-n) DRY=1; shift ;;
    -*)        echo "Unknown flag: $1" >&2; exit 2 ;;
    *)         [ -z "$NAME" ] && NAME="$1" || { echo "unexpected arg: $1" >&2; exit 2; }; shift ;;
  esac
done

[ -n "$NAME" ] || { echo "usage: globalize-skill.sh <name> [--from <repo>] [--target <dir>] [--force] [--dry-run]" >&2; exit 2; }

REPO="$(cd "$REPO" 2>/dev/null && pwd)" || { echo "no such repo: $REPO" >&2; exit 1; }
SKILL_DIR="$REPO/.claude/skills/$NAME"
SKILL_MD="$SKILL_DIR/SKILL.md"
[ -f "$SKILL_MD" ] || { echo "no skill '$NAME' in $REPO/.claude/skills/" >&2; exit 1; }

# Skills that don't belong in a global, non-project dir —
# single-sourced from bin/repo-bound-skills.txt (shared with install-skills.sh)
GUARDED=()
while IFS= read -r _s; do
  [[ -z "$_s" || "$_s" == \#* ]] && continue
  GUARDED+=("$_s")
done < "$SCRIPT_DIR/repo-bound-skills.txt"
for g in "${GUARDED[@]}"; do
  if [ "$g" = "$NAME" ] && [ "$FORCE" -eq 0 ]; then
    echo "'$NAME' is repo-bound or collides with a built-in; refusing." >&2
    echo "  (pass --force to override)" >&2
    exit 1
  fi
done

# Emit a self-contained SKILL.md: replace each bare `@<path>.md` line with the
# contents of that file (resolved relative to the stub). Non-import lines pass
# through, so a self-contained skill is copied verbatim.
inline_skill() {
  local md="$1" dir line rel inc
  dir="$(cd "$(dirname "$md")" && pwd)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*@(.+\.md)[[:space:]]*$ ]]; then
      rel="${BASH_REMATCH[1]}"
      inc="$(cd "$dir" && cd "$(dirname "$rel")" 2>/dev/null && pwd)/$(basename "$rel")" || true
      if [ -f "$inc" ]; then
        cat "$inc"
      else
        echo "ERROR: import not found: $rel (from $md)" >&2
        return 1
      fi
    else
      printf '%s\n' "$line"
    fi
  done < "$md"
}

RESOLVED="$(inline_skill "$SKILL_MD")" || exit 1
# The standalone skill keeps its notice beside SKILL.md, rather than above skills/.
RESOLVED="${RESOLVED//..\/THIRD_PARTY_NOTICES.txt/THIRD_PARTY_NOTICES.txt}"
REFERENCE="$REPO/skills/$NAME/reference.md"
REFERENCE_LINK="($NAME/reference.md)"
if [[ "$RESOLVED" == *"$REFERENCE_LINK"* ]] && [ ! -f "$REFERENCE" ]; then
  echo "ERROR: missing required reference: $REFERENCE" >&2
  exit 1
fi
RESOLVED="${RESOLVED//"$REFERENCE_LINK"/(reference.md)}"
NOTICES="$REPO/THIRD_PARTY_NOTICES.txt"
if [[ "$RESOLVED" == *THIRD_PARTY_NOTICES.txt* ]] && [ ! -f "$NOTICES" ]; then
  echo "ERROR: missing required notice: $NOTICES" >&2
  exit 1
fi

if [ "$DRY" -eq 1 ]; then
  echo "# DRY RUN — $NAME from $REPO  →  $TARGET/$NAME/"
  echo "# ---- resolved SKILL.md ----"
  printf '%s\n' "$RESOLVED"
  [ ! -f "$REFERENCE" ] || echo "# + would copy aux: reference.md"
  [ ! -f "$NOTICES" ] || echo "# + would copy aux: THIRD_PARTY_NOTICES.txt"
  # list aux files that would also be copied
  while IFS= read -r f; do
    [ "$(basename "$f")" = "SKILL.md" ] && continue
    echo "# + would copy aux: ${f#"$SKILL_DIR"/}"
  done < <(find "$SKILL_DIR" -type f)
  exit 0
fi

mkdir -p "$TARGET/$NAME"
printf '%s\n' "$RESOLVED" > "$TARGET/$NAME/SKILL.md"

# Copy any aux files the skill ships alongside SKILL.md (lib/, scripts/, …)
aux=0
while IFS= read -r f; do
  rel="${f#"$SKILL_DIR"/}"
  [ "$rel" = "SKILL.md" ] && continue
  mkdir -p "$TARGET/$NAME/$(dirname "$rel")"
  cp "$f" "$TARGET/$NAME/$rel"
  aux=$((aux+1))
done < <(find "$SKILL_DIR" -type f)

if [ -f "$REFERENCE" ]; then
  cp "$REFERENCE" "$TARGET/$NAME/reference.md"
  aux=$((aux+1))
fi

# Keep license text as a sidecar, never part of the resolved prompt.
if [ -f "$NOTICES" ]; then
  cp "$NOTICES" "$TARGET/$NAME/THIRD_PARTY_NOTICES.txt"
  aux=$((aux+1))
fi

echo "globalized: $NAME  ($REPO)  →  $TARGET/$NAME/"
[ "$aux" -gt 0 ] && echo "  + $aux aux file(s) copied"
grep -q '^@' "$SKILL_MD" && echo "  (import inlined — self-contained)" || echo "  (was already self-contained)"
exit 0
