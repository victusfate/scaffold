#!/usr/bin/env bash
# whisper-dictate — voice-activated dictation: listen, record while you speak,
# auto-stop after a beat of silence, transcribe locally with whisper.cpp, print
# the text and copy it to the clipboard (paste into any prompt).
# Why: no fixed timer — start talking when ready, stop when you stop. Uses sox's
# built-in silence detection (VAD), no extra deps. Run `bash scripts/whisper-setup.sh`
# first (it installs sox).
# Usage:
#   bash scripts/whisper-dictate.sh [--silence 1.5] [--threshold 2%] [--max 0] [--model base.en]
#     --silence <sec>   trailing silence that ends the take (default 0.8)
#     --threshold <pct> loudness floor counted as silence (default 2%)
#     --max <sec>       hard cap; 0 = none (default)
#     --model <name>    ggml model (default base.en)
set -euo pipefail

SIL=0.8
THRESH="2%"
MAX=0
MODEL="base.en"
for ((i = 1; i <= $#; i++)); do
  case "${!i}" in
    --silence) i=$((i + 1)); SIL="${!i}" ;;
    --threshold) i=$((i + 1)); THRESH="${!i}" ;;
    --max) i=$((i + 1)); MAX="${!i}" ;;
    --model) i=$((i + 1)); MODEL="${!i}" ;;
    *) echo "whisper-dictate: unknown option: ${!i}" >&2; exit 2 ;;
  esac
done

INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/whisper.cpp"
CLI="$INSTALL_DIR/build/bin/whisper-cli"
MODEL_FILE="$INSTALL_DIR/models/ggml-$MODEL.bin"
have() { command -v "$1" >/dev/null 2>&1; }

[ -x "$CLI" ] || { echo "whisper-dictate: whisper-cli not found — run: bash scripts/whisper-setup.sh" >&2; exit 1; }
[ -f "$MODEL_FILE" ] || { echo "whisper-dictate: model missing — run: bash scripts/whisper-setup.sh --model $MODEL" >&2; exit 1; }
have sox || { echo "whisper-dictate: sox not found — run: bash scripts/whisper-setup.sh" >&2; exit 1; }

clip="$(mktemp -t whisper-dictate).wav"
trap 'rm -f "$clip"' EXIT

echo "whisper-dictate: listening — start speaking; stops after ${SIL}s of silence (Ctrl-C to cancel)" >&2
# sox VAD: first `silence 1 0.1 THRESH` trims leading silence and starts the take
# on speech; the trailing `1 SIL THRESH` stops after SIL seconds below THRESH.
cap=""
[ "$MAX" != "0" ] && cap="trim 0 $MAX"
# shellcheck disable=SC2086
sox -d -r 16000 -c 1 "$clip" silence 1 0.1 "$THRESH" 1 "$SIL" "$THRESH" $cap >/dev/null 2>&1

THREADS="$( (command -v nproc >/dev/null 2>&1 && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
text="$("$CLI" -m "$MODEL_FILE" -f "$clip" -nt -t "$THREADS" 2>/dev/null | tr '\n' ' ' | sed -E 's/^ +//; s/ +$//; s/  +/ /g')"
[ -n "$text" ] || { echo "whisper-dictate: (no speech detected)" >&2; exit 0; }

# Copy to the clipboard using whatever the platform provides.
if have pbcopy; then printf '%s' "$text" | pbcopy
elif have wl-copy; then printf '%s' "$text" | wl-copy
elif have xclip; then printf '%s' "$text" | xclip -selection clipboard
elif have clip.exe; then printf '%s' "$text" | clip.exe
else echo "whisper-dictate: no clipboard tool (pbcopy/wl-copy/xclip/clip.exe) — text printed only" >&2; fi

printf '%s\n' "$text"
