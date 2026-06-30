#!/usr/bin/env bash
# whisper-dictate — record a short clip, transcribe it locally with whisper.cpp,
# print the text and copy it to the clipboard (paste into any prompt).
# Why: push-to-talk dictation for the agent loop; run `bash scripts/whisper-setup.sh`
# first (it installs sox for recording).
# Usage: bash scripts/whisper-dictate.sh [--seconds 8] [--model base.en]
set -euo pipefail

SECS=8
MODEL="base.en"
for ((i = 1; i <= $#; i++)); do
  case "${!i}" in
    --seconds) i=$((i + 1)); SECS="${!i}" ;;
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
echo "whisper-dictate: recording ${SECS}s — speak now..." >&2
sox -d -r 16000 -c 1 "$clip" trim 0 "$SECS" >/dev/null 2>&1

# whisper-cli prints the transcript to stdout; -nt drops timestamps.
text="$("$CLI" -m "$MODEL_FILE" -f "$clip" -nt 2>/dev/null | tr '\n' ' ' | sed -E 's/^ +//; s/ +$//; s/  +/ /g')"
[ -n "$text" ] || { echo "whisper-dictate: (no speech detected)" >&2; exit 0; }

# Copy to the clipboard using whatever the platform provides.
if have pbcopy; then printf '%s' "$text" | pbcopy
elif have wl-copy; then printf '%s' "$text" | wl-copy
elif have xclip; then printf '%s' "$text" | xclip -selection clipboard
elif have clip.exe; then printf '%s' "$text" | clip.exe
else echo "whisper-dictate: no clipboard tool (pbcopy/wl-copy/xclip/clip.exe) — text printed only" >&2; fi

printf '%s\n' "$text"
