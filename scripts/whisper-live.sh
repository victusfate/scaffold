#!/usr/bin/env bash
# whisper-live — live, word-by-word speech-to-text in the terminal via
# whisper.cpp's whisper-stream (see it convert as you speak). Fully local.
# Why: the "see it live" path; run `bash scripts/whisper-setup.sh` first.
# Usage: bash scripts/whisper-live.sh [--model base.en] [--terminal]
#   --terminal  open a new terminal window running this (so a skill/agent can
#               launch the interactive live view without the user typing it)
set -euo pipefail

MODEL="base.en"
TERMINAL=0
for ((i = 1; i <= $#; i++)); do
  case "${!i}" in
    --model) i=$((i + 1)); MODEL="${!i}" ;;
    --terminal) TERMINAL=1 ;;
    *) echo "whisper-live: unknown option: ${!i}" >&2; exit 2 ;;
  esac
done

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# Re-launch interactively in a fresh terminal window, then exit.
if [ "$TERMINAL" = 1 ]; then
  cmd="bash '$SELF' --model '$MODEL'"
  case "$(uname -s)" in
    Darwin)
      osascript -e "tell application \"Terminal\" to do script \"$cmd\"" \
                -e 'tell application "Terminal" to activate' >/dev/null
      echo "whisper-live: opened a Terminal window — speak there; Ctrl-C to stop." ;;
    Linux)
      for t in x-terminal-emulator gnome-terminal konsole xterm; do
        if command -v "$t" >/dev/null 2>&1; then exec "$t" -e bash -lc "$cmd"; fi
      done
      echo "whisper-live: no terminal emulator found — run: bash $SELF" >&2; exit 1 ;;
    *) echo "whisper-live: open a terminal and run: bash $SELF" >&2; exit 1 ;;
  esac
  exit 0
fi

INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/whisper.cpp"
STREAM="$INSTALL_DIR/build/bin/whisper-stream"
MODEL_FILE="$INSTALL_DIR/models/ggml-$MODEL.bin"

[ -x "$STREAM" ] || { echo "whisper-live: whisper-stream not found — run: bash scripts/whisper-setup.sh" >&2; exit 1; }
[ -f "$MODEL_FILE" ] || { echo "whisper-live: model missing — run: bash scripts/whisper-setup.sh --model $MODEL" >&2; exit 1; }

echo "whisper-live: speak — text appears live. Ctrl-C to stop."
exec "$STREAM" -m "$MODEL_FILE" -t 6 --step 500 --length 5000
