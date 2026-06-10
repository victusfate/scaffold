#!/usr/bin/env bash
# Pull agent guidance from scaffold into this repo.
# Run locally:  bash bin/sync-from-scaffold.sh
# Or trigger the .github/workflows/sync-scaffold.yml workflow.
#
# Clobber-safe behaviors:
#   - No silent first-sync overwrite: when no base SHA exists and the target
#     file already exists and differs, the incoming version is written to
#     <file>.scaffold-new for deliberate review; the target is left unchanged.
#   - .scaffold-keep: an optional file at the repo root (one path or glob per
#     line; # and blank lines ignored) — any matching path is always skipped.
set -euo pipefail

SCAFFOLD_URL="${SCAFFOLD_URL:-https://github.com/victusfate/scaffold.git}"
SHA_FILE=".github/scaffold-sync-sha"
SELF="bin/sync-from-scaffold.sh"

# All paths (manifest entries, SHA file, .scaffold-keep) are repo-root-relative
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "error: run inside a git repository" >&2
  exit 1
fi
cd "$REPO_ROOT"

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

# Read manifest from scaffold — a failed read must abort before any writes
# (a process-substitution failure is invisible to set -e and would otherwise
# no-op the loop and still save the SHA, silently marking us synced)
if ! manifest=$(git show scaffold/main:.github/scaffold-files.txt 2>/dev/null); then
  echo "error: could not read manifest .github/scaffold-files.txt from scaffold/main" >&2
  exit 1
fi
files=()
while IFS= read -r line; do
  [[ -n "$line" ]] && files+=("$line")
done <<< "$manifest"

updated=(); skipped=(); conflicts=(); review=(); kept=()
ours=''; base=''; theirs=''
trap 'rm -f "${ours:-}" "${base:-}" "${theirs:-}"' EXIT

# Returns 0 if $1 matches any pattern in .scaffold-keep, 1 otherwise.
in_keep_list() {
  local file="$1" pattern
  [ -f ".scaffold-keep" ] || return 1
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    # shellcheck disable=SC2053
    [[ "$file" == $pattern ]] && return 0
  done < ".scaffold-keep"
  return 1
}

sync_file() {
  local file="$1"
  git cat-file -e "scaffold/main:${file}" 2>/dev/null || return 0

  # Consumer keep list — always skip, even for new files
  if in_keep_list "$file"; then
    kept+=("$file")
    return 0
  fi

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
    # No base SHA — don't overwrite; save sidecar for deliberate review
    git show "scaffold/main:${file}" > "${file}.scaffold-new"
    review+=("$file  →  ${file}.scaffold-new")
  fi
}

# Self-update first: if scaffold has a newer version of this script and the
# working tree is clean, overwrite it and re-exec so the rest of the sync
# runs with the latest logic. exec replaces this process entirely — no bash
# buffering issue, and the re-exec'd process finds local==remote and skips
# the self-check. Falls through to sync_file below only when $SELF has local
# edits (treated as skipped, same as any other locally-modified file).
if git cat-file -e "scaffold/main:${SELF}" 2>/dev/null; then
  _remote=$(git rev-parse "scaffold/main:${SELF}")
  _local=$(git hash-object "$SELF")
  if [ "$_local" != "$_remote" ] \
     && git diff --quiet -- "$SELF" \
     && git diff --cached --quiet -- "$SELF"; then
    git show "scaffold/main:${SELF}" > "$SELF"
    exec bash "$SELF" "$@"
  fi
fi

for file in "${files[@]}"; do
  [ "$file" = "$SELF" ] && continue  # handled above; local-edit case handled below
  sync_file "$file"
done

# Local-edit fallback: if re-exec didn't fire (local edits on $SELF), run
# sync_file so it lands in skipped like any other locally-modified file.
sync_file "$SELF"

# Save SHA only when there are no unresolved conflicts or pending reviews
if [ ${#conflicts[@]} -eq 0 ] && [ ${#review[@]} -eq 0 ]; then
  mkdir -p "$(dirname "$SHA_FILE")"
  echo "$current_sha" > "$SHA_FILE"
fi

echo ""
[ ${#updated[@]}   -gt 0 ] && echo "Updated:"                                                              && printf '  %s\n' "${updated[@]}"
[ ${#kept[@]}      -gt 0 ] && echo "Kept (consumer-owned — matched .scaffold-keep):"                       && printf '  %s\n' "${kept[@]}"
[ ${#skipped[@]}   -gt 0 ] && echo "Skipped (uncommitted local edits — stash or commit first):"            && printf '  %s\n' "${skipped[@]}"
[ ${#review[@]}    -gt 0 ] && echo "Review (new upstream version saved alongside — diff and merge):"       && printf '  %s\n' "${review[@]}"
[ ${#conflicts[@]} -gt 0 ] && echo "Conflicts (resolve markers, commit, then re-run to save SHA):"         && printf '  %s\n' "${conflicts[@]}"
[ ${#updated[@]} -eq 0 ] && [ ${#kept[@]} -eq 0 ] && [ ${#skipped[@]} -eq 0 ] && [ ${#review[@]} -eq 0 ] && [ ${#conflicts[@]} -eq 0 ] && echo "Nothing to update."

[ ${#review[@]} -gt 0 ] || [ ${#conflicts[@]} -gt 0 ] && exit 1
exit 0
