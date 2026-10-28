#!/usr/bin/env bash
# setup-security-tools.sh — install the pinned third-party scanners scripts/security-scan.ts uses into the
# untracked .tooling/security/ of the main checkout (docs/security-review.md). This script is a gate file: run
# origin/main's copy, never a branch's:
#   git show origin/main:scripts/setup-security-tools.sh > "$tmp/setup.sh" && bash "$tmp/setup.sh"
#
# Off-language (bash, not TypeScript) by hard blocking need: every step is an external installer — `curl` of a
# release asset, `sha256sum -c`, `tar`, `python -m venv` + `pip`, `npm ci` — so a TypeScript port would be a
# line-for-line wrapper of these same commands with no logic of its own. Keep it this minimal.
#
# Supply-chain rules for the scanners themselves: exact versions, each release at least two weeks old when pinned;
# release checksums AND our pinned sha256 verified for downloads; PyPI tools pinned in an isolated venv; the ESLint
# stack installed with `npm ci --ignore-scripts` from the gate's own lockfile (scripts/security-eslint-stack/);
# the latest Semgrep registry rule packs (verified per scan by scripts/security-rules.ts). The gate files it reads
# (tool checksums, ESLint stack lockfile) come from origin/main, never the working tree. Every scan re-hashes each
# installed binary and the ESLint stack against scripts/security-tools.sha256, so a later swap fails the scan.
# Known gap: the PyPI tools' (semgrep, zizmor) transitive Python dependencies are version-resolved by pip, not
# hash-pinned (the scan pins zizmor's binary and semgrep's native semgrep-core, not semgrep's Python layer).
# Usage: setup-security-tools.sh   (re-run any time to refresh the rule packs to the latest)
set -euo pipefail
GITLEAKS=8.30.1 OSV=2.7.0 SEMGREP=1.180.0 ZIZMOR=1.30.1 CARGO_DENY=0.20.2
# Pinned at vetting time and verified against the release checksum files: the release's own checksums only
# prove the download is intact, these prove it is the same artifact we vetted.
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
OSV_SHA256=160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b
CARGO_DENY_SHA256=9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f
COMMON=$(git rev-parse --path-format=absolute --git-common-dir | sed 's|/\.git$||')
REF=origin/main
D=$COMMON/.tooling/security
mkdir -p "$D/bin" "$D/dl" "$D/rules" "$D/eslint"
printf '*\n' > "$D/.gitignore"   # never committed, even in repos that do not ignore .tooling/
fail() { echo "setup-security-tools: $*" >&2; exit 1; }
# A gate file as merged on origin/main (or this checkout's copy for the gate's own bootstrap merge).
gate_file() {
	if git -C "$COMMON" cat-file -e "$REF:$1" 2> /dev/null; then git -C "$COMMON" show "$REF:$1"
	elif [[ ${SECURITY_GATE_BOOTSTRAP:-} = 1 ]]; then cat "$COMMON/$1"
	else fail "origin/main has no $1 (set SECURITY_GATE_BOOTSTRAP=1 for the gate's first merge)"; fi
}
cd "$D/dl"
command -v curl > /dev/null || fail "curl is required (release downloads)"
# Release assets by their public download URL: no gh, no GitHub API and no token, so it works in cloud sandboxes
# whose proxy scopes the API to the session's own repos. Integrity comes from the checksums below, not the transport.
release() { # <owner/repo> <tag> <asset>...
	local repo=$1 tag=$2 a; shift 2
	for a in "$@"; do curl -sSfL --retry 3 -o "$a" "https://github.com/$repo/releases/download/$tag/$a" || fail "download of $repo $tag $a failed"; done
}

if [[ "$("$D/bin/gitleaks" version 2> /dev/null)" != "$GITLEAKS" ]]; then
	release gitleaks/gitleaks "v$GITLEAKS" "gitleaks_${GITLEAKS}_linux_x64.tar.gz" "gitleaks_${GITLEAKS}_checksums.txt"
	grep " gitleaks_${GITLEAKS}_linux_x64.tar.gz\$" "gitleaks_${GITLEAKS}_checksums.txt" | sha256sum -c - || fail "gitleaks checksum"
	echo "$GITLEAKS_SHA256  gitleaks_${GITLEAKS}_linux_x64.tar.gz" | sha256sum -c - || fail "gitleaks is not the pinned artifact"
	tar -xzf "gitleaks_${GITLEAKS}_linux_x64.tar.gz" -C "$D/bin" gitleaks
fi
if ! "$D/bin/osv-scanner" --version 2> /dev/null | grep -q "$OSV"; then
	release google/osv-scanner "v$OSV" osv-scanner_linux_amd64 osv-scanner_SHA256SUMS
	grep ' osv-scanner_linux_amd64$' osv-scanner_SHA256SUMS | sha256sum -c - || fail "osv-scanner checksum"
	echo "$OSV_SHA256  osv-scanner_linux_amd64" | sha256sum -c - || fail "osv-scanner is not the pinned artifact"
	install -m755 osv-scanner_linux_amd64 "$D/bin/osv-scanner"
fi
if ! "$D/bin/cargo-deny" --version 2> /dev/null | grep -q "$CARGO_DENY"; then
	# The release binary (a local `cargo install` build is not reproducible, so it could not be hash-pinned).
	tgz=cargo-deny-$CARGO_DENY-x86_64-unknown-linux-musl.tar.gz
	release EmbarkStudios/cargo-deny "$CARGO_DENY" "$tgz" "$tgz.sha256"
	[[ "$(cut -c1-64 "$tgz.sha256")" = "$(sha256sum "$tgz" | cut -c1-64)" ]] || fail "cargo-deny checksum"
	echo "$CARGO_DENY_SHA256  $tgz" | sha256sum -c - || fail "cargo-deny is not the pinned artifact"
	tar -xzf "$tgz" && install -m755 "cargo-deny-$CARGO_DENY-x86_64-unknown-linux-musl/cargo-deny" "$D/bin/cargo-deny"
fi
if [[ "$("$D/bin/semgrep" --version 2> /dev/null)" != "$SEMGREP" ]] || ! "$D/bin/zizmor" --version 2> /dev/null | grep -q "$ZIZMOR"; then
	# The system python may lack ensurepip; any python3 with venv support works.
	py=$(command -v python3); [[ -x $HOME/miniforge3/bin/python3 ]] && py=$HOME/miniforge3/bin/python3
	rm -rf "$D/venv" && "$py" -m venv "$D/venv"
	"$D/venv/bin/pip" install -q --disable-pip-version-check "semgrep==$SEMGREP" "zizmor==$ZIZMOR"
	ln -sf "$D/venv/bin/semgrep" "$D/bin/semgrep"
	ln -sf "$D/venv/bin/zizmor" "$D/bin/zizmor"
fi
# The ESLint stack: exactly the gate's lockfile, no install scripts.
gate_file scripts/security-eslint-stack/package.json > "$D/eslint/package.json.new"
gate_file scripts/security-eslint-stack/package-lock.json > "$D/eslint/package-lock.json.new"
if ! cmp -s "$D/eslint/package-lock.json.new" "$D/eslint/package-lock.json" || [[ ! -d $D/eslint/node_modules ]]; then
	mv -f "$D/eslint/package.json.new" "$D/eslint/package.json" && mv -f "$D/eslint/package-lock.json.new" "$D/eslint/package-lock.json"
	(cd "$D/eslint" && rm -rf node_modules && npm ci --ignore-scripts --no-audit --no-fund) || fail "ESLint stack install failed"
fi
rm -f "$D/eslint/"*.new
# Semgrep registry rule packs: always the LATEST (trust, but verify). Nothing is hash-pinned here; every scan diffs
# the served packs against the repo's accepted rule set (scripts/security-rules.ts) and keeps running the accepted
# version of any rule a new pack removed or weakened until an agent review accepts the change. The pack list must
# match PACKS in scripts/security-rules.ts. An offline refresh keeps the previous download.
for pack in default nodejsscan r2c-security-audit secrets typescript; do
	if curl -sfL --proto =https --proto-redir =https --max-filesize 50M --retry 3 "https://semgrep.dev/c/p/$pack" -o "$D/rules/$pack.yml.tmp" && [[ -s $D/rules/$pack.yml.tmp ]]; then
		mv -f "$D/rules/$pack.yml.tmp" "$D/rules/$pack.yml"
	elif [[ -s $D/rules/$pack.yml ]]; then
		rm -f "$D/rules/$pack.yml.tmp"
		echo "setup-security-tools: could not refresh semgrep pack $pack; keeping the previous download" >&2
	else
		fail "download of semgrep pack $pack failed"
	fi
done
echo "setup-security-tools: gitleaks $GITLEAKS, osv-scanner $OSV, semgrep $SEMGREP, zizmor $ZIZMOR, cargo-deny $CARGO_DENY and the ESLint stack ready in $D"
