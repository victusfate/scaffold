# voice-chat — hands-free voice loop for the coding agent

Talk to the coding agent with no keyboard. You speak, [whisper.cpp] transcribes,
`claude -p` does the real work (full tool use, flat-rate under your Claude Code
subscription — **not** the metered Agent SDK), and a local TTS backend speaks the
reply into your headphones. Headphones matter: the agent's own voice never leaks
into the mic, so no echo cancellation is needed.

Everything is local/offline **except** the LLM call, which rides your existing
subscription:

```
mic ──(sox rec, silence-gated)──▶ wav
    ──(whisper.cpp local model)──▶ text
    ──(claude -p --resume)───────▶ reply text   (full tools, flat-rate)
    ──(XTTS clone | Piper | say | espeak-ng)──▶ headphones
```

Turns run sequentially; a sox silence-gate handles endpointing (always-on VAD, no
push-to-talk).

## Platforms

Cross-platform: **macOS, Linux, WSL**. Capture and playback auto-detect the host
and every choice is env-overridable.

| | macOS | Linux / WSL |
|---|---|---|
| Recorder | `sox` (`rec`) | `sox` |
| Player | `afplay` | `paplay` (PulseAudio) — or set `VOICE_PLAYER=aplay` |
| Default TTS | `say` | `espeak-ng` |

## Install

```sh
# macOS
brew install sox whisper-cpp
# Linux / WSL (Debian/Ubuntu)
sudo apt install sox espeak-ng pulseaudio-utils
# whisper.cpp: build from source or install a prebuilt whisper-cli on PATH
```

Download a whisper model (once):

```sh
mkdir -p ~/.whisper-models
curl -L -o ~/.whisper-models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Verify everything is wired up:

```sh
node scripts/voice/voice-loop.ts --check
```

Then run it:

```sh
node scripts/voice/voice-loop.ts
```

Quit with `Ctrl-C` or by saying one of the exit phrases
(`stop listening`, `goodbye agent`, `that's all for now`).

## TTS backends

Set `VOICE_TTS_BACKEND` (or leave it `auto`):

- **`auto`** (default) — Piper if installed with a voice, else macOS `say`, else
  `espeak-ng`.
- **`say`** — macOS built-in. Voice via `VOICE_TTS_VOICE` (`say -v '?'` lists them).
- **`espeak`** — [espeak-ng], tiny and cross-platform. The portable fallback.
- **`piper`** — [Piper] local neural TTS. Point `VOICE_PIPER_MODEL` at an `.onnx`
  voice (e.g. `en_GB-alba-medium`).
- **`xtts`** — Coqui [XTTS-v2] voice clone: a free/local route to a **custom
  voice** cloned from a ~6s sample. Heavier (Python + a persistent model server),
  so it is never auto-selected. See below.

### XTTS voice clone (optional)

```sh
python3 -m venv ~/.xtts-venv
source ~/.xtts-venv/bin/activate
pip install -r scripts/voice/requirements.txt

# Get a ~6s speaker sample (record from your mic, or download one you host):
scripts/voice/fetch-sample.sh
# ...or: VOICE_SAMPLE_URL="https://example.com/voice-6s.wav" scripts/voice/fetch-sample.sh

VOICE_PYTHON=~/.xtts-venv/bin/python VOICE_TTS_BACKEND=xtts \
  node scripts/voice/voice-loop.ts
```

XTTS clones timbre reliably but accent only partially (per Coqui's docs), so
fidelity depends on the sample — keep it clean, dry, single-speaker. XTTS-v2 is
under the Coqui Public Model License (non-commercial); fine for personal use.

## Configuration

All env-overridable, all reversible in one line:

| Var | Default | What |
|---|---|---|
| `VOICE_TTS_BACKEND` | `auto` | `say` / `espeak` / `piper` / `xtts` |
| `VOICE_GREETING` | `Ready. I'm listening.` | spoken once at startup |
| `VOICE_SIGNOFF` | `Goodbye.` | spoken on exit phrase |
| `VOICE_WHISPER_MODEL` | `~/.whisper-models/ggml-base.en.bin` | STT model |
| `VOICE_WHISPER_BIN` | `whisper-cli` | whisper.cpp binary |
| `VOICE_ALLOWED_TOOLS` | `Read,Edit,Write,Bash,Glob,Grep` | agent tool allowlist |
| `VOICE_PLAYER` | `afplay` (mac) / `paplay` | wav player for piper/xtts |
| `VOICE_TTS_VOICE` | `Karen` | macOS `say` voice |
| `VOICE_ESPEAK_BIN` | `espeak-ng` | espeak binary |
| `VOICE_PIPER_MODEL` | `~/.piper-voices/en_GB-alba-medium.onnx` | Piper voice |
| `VOICE_XTTS_SPEAKER` | `~/.xtts-voices/sample.wav` | XTTS clone sample |
| `VOICE_START_THRESHOLD` / `VOICE_STOP_SECS` / `VOICE_STOP_THRESHOLD` | `1%` / `1.5` / `1%` | sox silence-gate tuning — the biggest lever on how the loop "feels" |

Give the loop a persona without touching code, e.g.:

```sh
VOICE_GREETING="Righto, I'm listening." VOICE_SIGNOFF="Sweet as, talk later." \
  node scripts/voice/voice-loop.ts
```

## Roadmap

- Silero VAD for sharper endpointing than the sox silence-gate
- Barge-in (interrupt the agent mid-reply)
- Streaming STT/TTS for lower latency

## Files

- `voice-loop.ts` — the loop (entry point)
- `xtts_server.py` — persistent XTTS voice-clone server (only for `xtts`)
- `requirements.txt` — Python deps for XTTS
- `fetch-sample.sh` — grab a ~6s speaker sample for XTTS

[whisper.cpp]: https://github.com/ggerganov/whisper.cpp
[espeak-ng]: https://github.com/espeak-ng/espeak-ng
[Piper]: https://github.com/rhasspy/piper
[XTTS-v2]: https://huggingface.co/coqui/XTTS-v2
