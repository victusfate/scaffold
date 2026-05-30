#!/usr/bin/env bash
# Pull agent guidance from scaffold into this repo.
# Run locally:  bash bin/sync-from-scaffold.sh
# Or trigger the .github/workflows/sync-scaffold.yml workflow.
set -euo pipefail

SCAFFOLD_URL="${SCAFFOLD_URL:-https://github.com/victusfate/scaffold.git}"
SHA_FILE=".github/scaffold-sync-sha"
SELF="bin/sync-from-scaffold.sh"

# Ensure scaffold remote exists
if ! git remote get-url scaffold &>/dev/null; then
  git remote add scaffold "$SCAFFOLD_URL"
  echo "Added remote 'scaffold' → $SCAFFOLD_URL"
fi

git fetch scaffold main --quiet

current_sha=$(git rev-parse scaffold/main)
last_sha=$(cat "$SHA_FILE" 2>/dev/null || echo "")

if [ "$current_sha" = "$last_sha" ]; then
  echo "Already up to date (${current_sha:0:7})."
  exit 0
fi

echo "Syncing to ${current_sha:0:7}${last_sha:+ (from ${last_sha:0:7})}..."

# Read manifest from scaffold
files=()
while IFS= read -r line; do
  [[ -n "$line" ]] && files+=("$line")
done < <(git show scaffold/main:.github/scaffold-files.txt)

updated=(); skipped=(); conflicts=()
ours=''; base=''; theirs=''
trap 'rm -f "${ours:-}" "${base:-}" "${theirs:-}"' EXIT

sync_file() {
  local file="$1"
  git cat-file -e "scaffold/main:${file}" 2>/dev/null || return 0

  mkdir -p "$(dirname "$file")"

  # New file — just write it
  if [ ! -f "$file" ]; then
    git show "scaffold/main:${file}" > "$file"
    updated+=("+ $file")
    return 0
  fi

  # Identical (compare blob SHAs) — nothing to do
  local remote_blob local_blob
  remote_blob=$(git rev-parse "scaffold/main:${file}")
  local_blob=$(git hash-object "$file")
  [ "$local_blob" = "$remote_blob" ] && return 0

  # Uncommitted local edits (working tree or index) — don't touch
  if ! git diff --quiet -- "$file" || ! git diff --cached --quiet -- "$file"; then
    skipped+=("$file")
    return 0
  fi

  # Three-way merge using last synced SHA as base
  if [ -n "$last_sha" ] && git cat-file -e "${last_sha}:${file}" 2>/dev/null; then
    ours=$(mktemp); base=$(mktemp); theirs=$(mktemp)
    cp "$file" "$ours"
    git show "${last_sha}:${file}" > "$base"
    git show "scaffold/main:${file}" > "$theirs"

    if git merge-file -p "$ours" "$base" "$theirs" > "$file" 2>/dev/null; then
      updated+=("M $file")
    else
      # non-zero exit means conflicts; -p already wrote markers to $file
      conflicts+=("$file")
    fi
    rm -f "$ours" "$base" "$theirs"
    ours=''; base=''; theirs=''
  else
    # No base available — overwrite
    git show "scaffold/main:${file}" > "$file"
    updated+=("~ $file (no base, overwritten)")
  fi
}

for file in "${files[@]}"; do
  [ "$file" = "$SELF" ] && continue  # deferred — see below
  sync_file "$file"
done

# Self-update last: bash reads scripts in buffered chunks, so overwriting
# this file mid-loop shifts bash's read offset and causes spurious syntax
# errors. Deferring it ensures the rest of the script runs from its
# original on-disk content before the file is replaced.
sync_file "$SELF"

# Save SHA only when there are no unresolved conflicts
[ ${#conflicts[@]} -eq 0 ] && echo "$current_sha" > "$SHA_FILE"

echo ""
[ ${#updated[@]}   -gt 0 ] && echo "Updated:"                                                        && printf '  %s\n' "${updated[@]}"
[ ${#skipped[@]}   -gt 0 ] && echo "Skipped (uncommitted local edits — stash or commit first):"      && printf '  %s\n' "${skipped[@]}"
[ ${#conflicts[@]} -gt 0 ] && echo "Conflicts (resolve markers, commit, then re-run to save SHA):"   && printf '  %s\n' "${conflicts[@]}"
[ ${#updated[@]} -eq 0 ] && [ ${#skipped[@]} -eq 0 ] && [ ${#conflicts[@]} -eq 0 ] && echo "Nothing to update."

[ ${#conflicts[@]} -gt 0 ] && exit 1
exit 0
