#!/usr/bin/env bash
# whisper-live — live, word-by-word speech-to-text in the terminal via
# whisper.cpp's whisper-stream (see it convert as you speak). Fully local.
# Why: the "see it live" path; run `bash scripts/whisper-setup.sh` first.
# Usage: bash scripts/whisper-live.sh [--model base.en]
set -euo pipefail

MODEL="base.en"
for ((i = 1; i <= $#; i++)); do
  case "${!i}" in
    --model) i=$((i + 1)); MODEL="${!i}" ;;
    *) echo "whisper-live: unknown option: ${!i}" >&2; exit 2 ;;
  esac
done

INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/whisper.cpp"
STREAM="$INSTALL_DIR/build/bin/whisper-stream"
MODEL_FILE="$INSTALL_DIR/models/ggml-$MODEL.bin"

[ -x "$STREAM" ] || { echo "whisper-live: whisper-stream not found — run: bash scripts/whisper-setup.sh" >&2; exit 1; }
[ -f "$MODEL_FILE" ] || { echo "whisper-live: model missing — run: bash scripts/whisper-setup.sh --model $MODEL" >&2; exit 1; }

echo "whisper-live: speak — text appears live. Ctrl-C to stop."
exec "$STREAM" -m "$MODEL_FILE" -t 6 --step 500 --length 5000
