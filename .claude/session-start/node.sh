#!/usr/bin/env bash
# node.sh: SessionStart hook — puts the Node major pinned in .node-version on PATH.
# In a Claude Code cloud session (CLAUDE_CODE_REMOTE=true) a mismatched Node is
# replaced by downloading the latest release of the pinned major into
# ~/.local/node-<version> and exporting it through CLAUDE_ENV_FILE, so every Bash
# command in the session sees it. Locally it only warns — your version manager
# (fnm, nvm with .node-version support, mise, n, volta) owns your machine.
# Exits 0 always — a toolchain hiccup must never block a session.

VERSION_FILE="${CLAUDE_PROJECT_DIR:-.}/.node-version"
[ -f "$VERSION_FILE" ] || exit 0

WANT=$(tr -d ' v\r\n' < "$VERSION_FILE")
WANT_MAJOR="${WANT%%.*}"
HAVE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "none")
[ "$HAVE_MAJOR" = "$WANT_MAJOR" ] && exit 0

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "⚠  Node $HAVE_MAJOR is active but .node-version pins $WANT — switch with your version manager (e.g. fnm use)"
  exit 0
fi

case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) exit 0 ;;
esac

# Resolve the newest release of the pinned major from the official index.
FULL=$(curl -fsSL https://nodejs.org/dist/index.json 2>/dev/null |
  grep -o "\"version\":\"v${WANT_MAJOR}\.[0-9.]*\"" | head -1 | cut -d'"' -f4)
[ -n "$FULL" ] || { echo "⚠  could not resolve Node $WANT_MAJOR release — staying on Node $HAVE_MAJOR"; exit 0; }

DEST="$HOME/.local/node-$FULL"
if [ ! -x "$DEST/bin/node" ]; then
  mkdir -p "$DEST"
  curl -fsSL "https://nodejs.org/dist/$FULL/node-$FULL-linux-$ARCH.tar.xz" 2>/dev/null |
    tar -xJ --strip-components=1 -C "$DEST" 2>/dev/null ||
    { rm -rf "$DEST"; echo "⚠  Node $FULL download failed — staying on Node $HAVE_MAJOR"; exit 0; }
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$DEST/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
echo "Node $FULL active (pinned by .node-version)"
