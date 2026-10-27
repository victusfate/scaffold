#!/usr/bin/env bash
# setup-security-tools.sh — install the pinned third-party scanners scripts/security-scan.ts uses into the
# untracked .tooling/security/ of the main checkout (docs/security-review.md).
#
# Off-language (bash, not TypeScript) by hard blocking need: every step is an external installer — `gh release
# download`, `sha256sum -c`, `tar`, `python -m venv` + `pip`, `cargo install` — so a TypeScript port would be a
# line-for-line wrapper of these same commands with no logic of its own. Keep it this minimal.
#
# Supply-chain rules for the scanners themselves: exact versions, each release at least two weeks old when
# pinned, release checksums AND our pinned sha256 verified for binaries, PyPI tools pinned in an isolated venv,
# cargo tools built with --locked, Semgrep registry rule packs downloaded once and verified against the TRACKED
# scripts/security-rules.sha256. Known gap: the PyPI tools' (semgrep, zizmor) transitive dependencies are
# version-resolved by pip, not hash-pinned.
# Usage: scripts/setup-security-tools.sh [--refresh-rules]
set -euo pipefail
GITLEAKS=8.30.1 OSV=2.7.0 SEMGREP=1.180.0 ZIZMOR=1.30.1 CARGO_DENY=0.20.2
# Pinned at vetting time and verified against the release checksum files: the release's own checksums only
# prove the download is intact, these prove it is the same artifact we vetted.
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
OSV_SHA256=160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b
COMMON=$(git rev-parse --path-format=absolute --git-common-dir | sed 's|/\.git$||')
REPO=$COMMON   # the main checkout's tracked rule checksums, never a lane worktree's copy
D=$COMMON/.tooling/security
mkdir -p "$D/bin" "$D/dl" "$D/rules"
printf '*\n' > "$D/.gitignore"   # never committed, even in repos that do not ignore .tooling/
cd "$D/dl"
fail() { echo "setup-security-tools: $*" >&2; exit 1; }
command -v gh > /dev/null || fail "gh is required (release downloads)"

if [[ "$("$D/bin/gitleaks" version 2> /dev/null)" != "$GITLEAKS" ]]; then
	gh release download "v$GITLEAKS" -R gitleaks/gitleaks -p "gitleaks_${GITLEAKS}_linux_x64.tar.gz" -p "gitleaks_${GITLEAKS}_checksums.txt" --clobber
	grep " gitleaks_${GITLEAKS}_linux_x64.tar.gz\$" "gitleaks_${GITLEAKS}_checksums.txt" | sha256sum -c - || fail "gitleaks checksum"
	echo "$GITLEAKS_SHA256  gitleaks_${GITLEAKS}_linux_x64.tar.gz" | sha256sum -c - || fail "gitleaks is not the pinned artifact"
	tar -xzf "gitleaks_${GITLEAKS}_linux_x64.tar.gz" -C "$D/bin" gitleaks
fi
if ! "$D/bin/osv-scanner" --version 2> /dev/null | grep -q "$OSV"; then
	gh release download "v$OSV" -R google/osv-scanner -p osv-scanner_linux_amd64 -p osv-scanner_SHA256SUMS --clobber
	grep ' osv-scanner_linux_amd64$' osv-scanner_SHA256SUMS | sha256sum -c - || fail "osv-scanner checksum"
	echo "$OSV_SHA256  osv-scanner_linux_amd64" | sha256sum -c - || fail "osv-scanner is not the pinned artifact"
	install -m755 osv-scanner_linux_amd64 "$D/bin/osv-scanner"
fi
if [[ "$("$D/bin/semgrep" --version 2> /dev/null)" != "$SEMGREP" ]] || ! "$D/bin/zizmor" --version 2> /dev/null | grep -q "$ZIZMOR"; then
	# The system python may lack ensurepip; any python3 with venv support works.
	py=$(command -v python3); [[ -x $HOME/miniforge3/bin/python3 ]] && py=$HOME/miniforge3/bin/python3
	rm -rf "$D/venv" && "$py" -m venv "$D/venv"
	"$D/venv/bin/pip" install -q --disable-pip-version-check "semgrep==$SEMGREP" "zizmor==$ZIZMOR"
	ln -sf "$D/venv/bin/semgrep" "$D/bin/semgrep"
	ln -sf "$D/venv/bin/zizmor" "$D/bin/zizmor"
fi
if ! "$D/bin/cargo-deny" --version 2> /dev/null | grep -q "$CARGO_DENY"; then
	cargo install --locked --version "$CARGO_DENY" cargo-deny --root "$D"
fi
# Semgrep registry rule packs: the expected sha256 of each is TRACKED (scripts/security-rules.sha256), so a
# changed pack is a reviewed repo change, never a silent download. --refresh-rules re-downloads and rewrites
# that file (commit it after reviewing the rule diff; the gate holds it as a gate change for owner sign-off).
SUMS=$REPO/scripts/security-rules.sha256
for pack in default secrets r2c-security-audit; do
	if [[ ${1:-} = --refresh-rules || ! -f $D/rules/$pack.yml ]]; then
		curl -sfL "https://semgrep.dev/c/p/$pack" -o "$D/rules/$pack.yml.tmp" || fail "download of semgrep pack $pack failed"
		mv -f "$D/rules/$pack.yml.tmp" "$D/rules/$pack.yml"
	fi
done
[[ ${1:-} = --refresh-rules ]] && (cd "$D/rules" && sha256sum ./default.yml ./r2c-security-audit.yml ./secrets.yml > "$SUMS")
[[ -f $SUMS ]] || fail "no tracked rule checksums at $SUMS"
(cd "$D/rules" && sha256sum -c --quiet "$SUMS") || fail "semgrep rule packs differ from scripts/security-rules.sha256; review, then --refresh-rules"
echo "setup-security-tools: gitleaks $GITLEAKS, osv-scanner $OSV, semgrep $SEMGREP, zizmor $ZIZMOR, cargo-deny $CARGO_DENY ready in $D/bin"
