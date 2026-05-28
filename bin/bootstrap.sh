#!/usr/bin/env bash
# One-time setup for a downstream repo. Run from the repo root:
#   curl -fsSL https://raw.githubusercontent.com/victusfate/scaffold/main/bin/bootstrap.sh | bash
set -euo pipefail

SCAFFOLD_URL="https://github.com/victusfate/scaffold.git"

if ! git rev-parse --show-toplevel &>/dev/null; then
  echo "error: run from the root of a git repository" >&2
  exit 1
fi

echo "Bootstrapping scaffold agent guidance..."

# Add scaffold remote and fetch
if ! git remote get-url scaffold &>/dev/null; then
  git remote add scaffold "$SCAFFOLD_URL"
  echo "Added remote 'scaffold' → $SCAFFOLD_URL"
fi
git fetch scaffold main --depth=1 --quiet

# Install the sync script and workflow using git — no curl needed from here on
mkdir -p bin .github/workflows
git show scaffold/main:bin/sync-from-scaffold.sh > bin/sync-from-scaffold.sh
chmod +x bin/sync-from-scaffold.sh
git show scaffold/main:.github/workflows/sync-scaffold.yml > .github/workflows/sync-scaffold.yml
echo "Installed bin/sync-from-scaffold.sh"
echo "Installed .github/workflows/sync-scaffold.yml"
echo ""

# Run the full sync
bash bin/sync-from-scaffold.sh
