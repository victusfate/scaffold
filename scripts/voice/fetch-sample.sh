#!/usr/bin/env bash
# fetch-sample.sh — get a ~6s speaker sample for the optional XTTS voice-clone
# backend and drop it where voice-loop.ts expects it ($VOICE_XTTS_SPEAKER,
# default ~/.xtts-voices/sample.wav).
#
# Two neutral ways to get one — pick whichever you like:
#   1. Record from your own mic (default): needs sox.
#        scripts/voice/fetch-sample.sh
#   2. Download a clip you already host, e.g. a public-domain / CC voice sample
#      in your preferred accent (this is where victus points at its NZ clip):
#        VOICE_SAMPLE_URL="https://example.com/voice-6s.wav" scripts/voice/fetch-sample.sh
#
# XTTS clones timbre from ~6 seconds of clean, single-speaker speech. Keep it
# dry (no music/noise), 16-bit mono/stereo wav, roughly 6–10s.
set -euo pipefail

DEST="${VOICE_XTTS_SPEAKER:-$HOME/.xtts-voices/sample.wav}"
SECONDS_LEN="${VOICE_SAMPLE_SECS:-6}"
mkdir -p "$(dirname "$DEST")"

if [ -n "${VOICE_SAMPLE_URL:-}" ]; then
  echo "Downloading sample from \$VOICE_SAMPLE_URL -> $DEST"
  if command -v curl >/dev/null 2>&1; then
    curl -fL -o "$DEST" "$VOICE_SAMPLE_URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$DEST" "$VOICE_SAMPLE_URL"
  else
    echo "error: need curl or wget to download" >&2
    exit 1
  fi
else
  if ! command -v rec >/dev/null 2>&1 && ! command -v sox >/dev/null 2>&1; then
    echo "error: sox not found — install it (brew install sox / apt install sox)" >&2
    echo "       or set VOICE_SAMPLE_URL to download a clip instead." >&2
    exit 1
  fi
  REC=rec
  command -v rec >/dev/null 2>&1 || REC="sox -d"
  SAMPLE_HZ=22050  # 22.05 kHz mono is plenty for an XTTS speaker sample
  BIT_DEPTH=16     # 16-bit PCM wav
  echo "Recording ${SECONDS_LEN}s from your mic — speak naturally now…"
  # shellcheck disable=SC2086  # $REC may be "sox -d" (two words) on purpose.
  $REC -c 1 -r "$SAMPLE_HZ" -b "$BIT_DEPTH" "$DEST" trim 0 "$SECONDS_LEN"
fi

echo "Sample ready at $DEST"
echo "Use it:  VOICE_TTS_BACKEND=xtts node scripts/voice/voice-loop.ts"
