#!/usr/bin/env bash
# node.sh: SessionStart hook — puts the Node major pinned in .node-version on PATH.
# Only the major is honored (a pin of 26.1.0 installs the newest 26.x); pin exact
# versions with your local version manager or setup-node.
# In a Claude Code cloud session (CLAUDE_CODE_REMOTE=true) a mismatched Node is
# replaced by downloading the latest release of the pinned major into
# ~/.local/node-<version> and exporting it through CLAUDE_ENV_FILE, so every Bash
# command in the session sees it. Locally it only warns — your version manager
# (fnm, nvm with .node-version support, mise, n, volta) owns your machine.
# Exits 0 always — a toolchain hiccup must never block a session.

NODE_DIST=https://nodejs.org/dist
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
FULL=$(curl -fsSL "$NODE_DIST/index.json" 2>/dev/null |
  grep -o "\"version\":\"v${WANT_MAJOR}\.[0-9.]*\"" | head -1 | cut -d'"' -f4)
[ -n "$FULL" ] || { echo "⚠  could not resolve Node $WANT_MAJOR release — staying on Node $HAVE_MAJOR"; exit 0; }

DEST="$HOME/.local/node-$FULL"
TARBALL="node-$FULL-linux-$ARCH.tar.xz"
# Download to a temp dir, check the release's SHA-256, extract, and run the binary before moving it into
# place. An interrupted download once left a truncated node that segfaulted on every call, and a bare
# "file exists" check kept reusing it.
install_node() {
  local tmp rc
  tmp=$(mktemp -d) || return 1
  curl -fsSL "$NODE_DIST/$FULL/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" &&
    curl -fsSL "$NODE_DIST/$FULL/$TARBALL" -o "$tmp/$TARBALL" &&
    (cd "$tmp" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c --status) &&
    mkdir "$tmp/node" && tar -xJf "$tmp/$TARBALL" --strip-components=1 -C "$tmp/node" &&
    "$tmp/node/bin/node" -e 0 &&
    rm -rf "$DEST" && mkdir -p "$(dirname "$DEST")" && mv "$tmp/node" "$DEST"
  rc=$?
  rm -rf "$tmp"
  return $rc
}
if ! { ("$DEST/bin/node" -e 0) > /dev/null 2>&1; } 2> /dev/null; then
  install_node 2>/dev/null || { echo "⚠  Node $FULL download or verification failed — staying on Node $HAVE_MAJOR"; exit 0; }
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$DEST/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
echo "Node $FULL active (pinned by .node-version)"
