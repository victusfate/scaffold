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

# Skills that should NOT go into a global, non-project dir by default:
#   sync-scaffold        — orchestrates an in-repo git sync; needs a project repo
#   code-review, simplify — collide with Claude Code's built-in skills of the
#                          same name (installing here would shadow the built-ins)
SKIP=(sync-scaffold code-review simplify)

command -v rsync >/dev/null || { echo "rsync is required" >&2; exit 1; }
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
installed=(); skipped=()

for path in "$SRC"/*/; do
  name="$(basename "$path")"
  if [ "$ALL" -eq 0 ] && is_skipped "$name"; then
    skipped+=("$name"); continue
  fi
  if [ "$DRY" -eq 1 ]; then
    installed+=("$name"); continue
  fi
  if [ "$LINK" -eq 1 ]; then
    rm -rf "$TARGET/$name"
    ln -s "${path%/}" "$TARGET/$name"
  else
    rsync -a --delete "$path" "$TARGET/$name/"
  fi
  installed+=("$name")
done

echo ""
mode=$([ "$LINK" -eq 1 ] && echo " (symlinks)" || echo "")
echo "scaffold @ $SHA  →  $TARGET$mode"
[ "$DRY" -eq 1 ] && echo "(dry run — nothing written)"
[ ${#installed[@]} -gt 0 ] && { echo "Installed (${#installed[@]}):"; printf '  + %s\n' "${installed[@]}"; }
[ ${#skipped[@]}   -gt 0 ] && { echo "Skipped (pass --all to include):"; printf '  - %s\n' "${skipped[@]}"; }
exit 0
