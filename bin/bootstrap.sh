#!/usr/bin/env bash
# One-time setup for a downstream repo. Run from the repo root:
#   curl -fsSL https://raw.githubusercontent.com/victusfate/scaffold/main/bin/bootstrap.sh | bash
#
# What this does by default:
#   - Adds the scaffold git remote.
#   - Installs bin/sync-from-scaffold.sh.
#   - Prints the command to run the first sync manually.
#   - Does NOT run the sync automatically (no tracked files are changed).
#   - Does NOT install the sync workflow (opt-in via --with-workflow).
#
# Flags:
#   --run             Also run bin/sync-from-scaffold.sh immediately after install.
#   --with-workflow   Also install .github/workflows/sync-scaffold.yml.
set -euo pipefail

SCAFFOLD_URL="${SCAFFOLD_URL:-https://github.com/victusfate/scaffold.git}"
RUN_SYNC=0
WITH_WORKFLOW=0

for arg in "$@"; do
  case "$arg" in
    --run)           RUN_SYNC=1 ;;
    --with-workflow) WITH_WORKFLOW=1 ;;
    *)               echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "error: run inside a git repository" >&2
  exit 1
fi
cd "$REPO_ROOT"

echo "Bootstrapping scaffold agent guidance..."

# Add scaffold remote and fetch
if ! git remote get-url scaffold &>/dev/null; then
  git remote add scaffold "$SCAFFOLD_URL"
  echo "Added remote 'scaffold' → $SCAFFOLD_URL"
fi
git fetch scaffold main --depth=1 --quiet

# Install the sync script using git — no curl needed from here on
mkdir -p bin
git show scaffold/main:bin/sync-from-scaffold.sh > bin/sync-from-scaffold.sh
chmod +x bin/sync-from-scaffold.sh
echo "Installed bin/sync-from-scaffold.sh"

# Install the sync workflow only when explicitly requested
if [ "$WITH_WORKFLOW" -eq 1 ]; then
  mkdir -p .github/workflows
  git show scaffold/main:.github/workflows/sync-scaffold.yml > .github/workflows/sync-scaffold.yml
  echo "Installed .github/workflows/sync-scaffold.yml"
fi

echo ""

if [ "$RUN_SYNC" -eq 1 ]; then
  echo "Running first sync..."
  bash bin/sync-from-scaffold.sh
else
  echo "Setup complete. No tracked files were changed."
  echo ""
  echo "Run the first sync when ready:"
  echo "  bash bin/sync-from-scaffold.sh"
  echo ""
  echo "Or re-run bootstrap with --run to sync immediately:"
  echo "  bash bin/bootstrap.sh --run"
  if [ "$WITH_WORKFLOW" -eq 0 ]; then
    echo ""
    echo "To also install the automated sync workflow:"
    echo "  bash bin/bootstrap.sh --with-workflow"
  fi
fi
