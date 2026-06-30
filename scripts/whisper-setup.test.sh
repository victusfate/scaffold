#!/usr/bin/env bash
# Tests for the whisper scripts — syntax + side-effect-free --detect behavior.
# Does NOT install/build (that is heavy and machine-specific).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
passed=0; failed=0
ok()  { echo "  pass  $1"; passed=$((passed + 1)); }
bad() { echo "  FAIL  $1${2:+ — $2}"; failed=$((failed + 1)); }

# 1. all three scripts parse
for s in whisper-setup whisper-live whisper-dictate; do
  if bash -n "$ROOT/scripts/$s.sh"; then ok "$s.sh parses"; else bad "$s.sh parses"; fi
done

# 2. --detect prints the plan and exits 0, no side effects
out="$(bash "$ROOT/scripts/whisper-setup.sh" --detect)"; rc=$?
[ "$rc" -eq 0 ] && ok "--detect exits 0" || bad "--detect exits 0" "rc=$rc"
for key in "os:" "model:" "install_dir:" "deps:" "live_binary:" "cli_binary:"; do
  echo "$out" | grep -q "$key" && ok "--detect prints $key" || bad "--detect prints $key" "$out"
done

# 3. --model is honored
echo "$(bash "$ROOT/scripts/whisper-setup.sh" --detect --model tiny.en)" | grep -q "model: tiny.en" \
  && ok "--model honored" || bad "--model honored"

# 4. detected OS is one of the known values
osline="$(bash "$ROOT/scripts/whisper-setup.sh" --detect | sed -n 's/^os: //p')"
case "$osline" in macos | linux | windows) ok "OS detected ($osline)" ;; *) bad "OS detected" "$osline" ;; esac

# 5. unknown option is rejected non-zero
bash "$ROOT/scripts/whisper-setup.sh" --bogus >/dev/null 2>&1 && bad "rejects unknown option" || ok "rejects unknown option"

echo ""
echo "whisper-setup: $passed passed, $failed failed"
[ "$failed" -eq 0 ]
