#!/usr/bin/env bash
# install-skills.sh — copy scaffold's agent skills into a target skills dir
# WITHOUT requiring the target to be a git repo.
#
# Use case: local cross-repo convenience. Populate ~/.claude/skills so every
# project you open in the local Claude CLI sees scaffold's skills, without
# committing them into each repo and without making your home a git repo.
#
#   NOTE: this is the LOCAL path only. A Claude Code cloud/mobile sandbox
#   clones a single repo and never sees ~/.claude/skills — for cloud, the
#   skills must be committed in that repo's .claude/skills/ (use
#   bin/sync-from-scaffold.sh inside the project instead).
#
# Source: this scaffold checkout's .claude/skills/ (optionally --pull first).
# Target: any plain directory. Default: ~/.claude/skills. No git at the target.
#
# Usage:
#   bash bin/install-skills.sh [TARGET_DIR] [--all] [--link] [--pull] [--dry-run]
#
#   TARGET_DIR   where skills land. Default: ~/.claude/skills
#   --all        install every skill. Default skips ones that don't belong
#                in a global, non-project dir (see SKIP below).
#   --link       symlink instead of copy (live — tracks scaffold as you pull;
#                breaks if the scaffold checkout moves). Default is a real copy.
#   --pull       git pull --ff-only in scaffold first, so you install the latest.
#   --dry-run    show what would change, write nothing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/.claude/skills"

TARGET="${HOME}/.claude/skills"
ALL=0; LINK=0; PULL=0; DRY=0
for arg in "$@"; do
  case "$arg" in
    --all)            ALL=1 ;;
    --link)           LINK=1 ;;
    --pull)           PULL=1 ;;
    --dry-run|-n)     DRY=1 ;;
    -*)               echo "Unknown flag: $arg" >&2; exit 2 ;;
    *)                TARGET="$arg" ;;
  esac
done

# Skills that should NOT go into a global, non-project dir by default —
# single-sourced from bin/repo-bound-skills.txt (shared with globalize-skill.sh)
SKIP=()
while IFS= read -r _s; do
  [[ -z "$_s" || "$_s" == \#* ]] && continue
  SKIP+=("$_s")
done < "$SCRIPT_DIR/repo-bound-skills.txt"

[ -x "$SCRIPT_DIR/globalize-skill.sh" ] || { echo "missing $SCRIPT_DIR/globalize-skill.sh" >&2; exit 1; }
[ -d "$SRC" ] || { echo "no skills dir at $SRC" >&2; exit 1; }

if [ "$PULL" -eq 1 ]; then
  echo "Pulling scaffold (ff-only)…"
  git -C "$ROOT" pull --ff-only
fi
SHA=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

is_skipped() {
  local n="$1" s
  for s in "${SKIP[@]}"; do [ "$s" = "$n" ] && return 0; done
  return 1
}

[ "$DRY" -eq 1 ] || mkdir -p "$TARGET"
installed=(); skipped=(); failed=()

for path in "$SRC"/*/; do
  name="$(basename "$path")"
  if [ "$ALL" -eq 0 ] && is_skipped "$name"; then
    skipped+=("$name"); continue
  fi
  if [ "$DRY" -eq 1 ]; then
    installed+=("$name"); continue
  fi
  if [ "$LINK" -eq 1 ]; then
    # Symlink: the stub's @import resolves through the real scaffold path, so
    # it stays live (and breaks if the scaffold checkout moves — see header).
    rm -rf "$TARGET/$name"
    ln -s "${path%/}" "$TARGET/$name"
    installed+=("$name")
  else
    # Copy via globalize-skill so the @import is inlined into a self-contained
    # SKILL.md. A flat rsync of the stub would leave a dangling
    # @../../../skills/<name>.md and the skill would be broken on arrival.
    # --force: bulk SKIP above is the authority on what's excluded here.
    if bash "$SCRIPT_DIR/globalize-skill.sh" "$name" --from "$ROOT" --target "$TARGET" --force >/dev/null; then
      installed+=("$name")
    else
      failed+=("$name")
    fi
  fi
done

echo ""
mode=$([ "$LINK" -eq 1 ] && echo " (symlinks)" || echo "")
echo "scaffold @ $SHA  →  $TARGET$mode"
[ "$DRY" -eq 1 ] && echo "(dry run — nothing written)"
[ ${#installed[@]} -gt 0 ] && { echo "Installed (${#installed[@]}):"; printf '  + %s\n' "${installed[@]}"; }
[ ${#skipped[@]}   -gt 0 ] && { echo "Skipped (pass --all to include):"; printf '  - %s\n' "${skipped[@]}"; }
[ ${#failed[@]}    -gt 0 ] && { echo "Failed (import unresolved — see errors above):"; printf '  ! %s\n' "${failed[@]}"; }
[ ${#failed[@]} -gt 0 ] && exit 1
exit 0
