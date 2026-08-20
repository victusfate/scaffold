## Instructions

> **Multi-harness:** This skill spawns the agent binary as a subprocess. Detect the
> harness at runtime: if `PI_CODING_AGENT` is set, use `pi -p`; if `AGY` or
> `ANTIGRAVITY` env vars are set, use `agy -p`; otherwise default to `claude -p`.
> The `--resume` flag is Claude Code-specific; pi uses `--continue` / `-c`, agy
> uses `--continue` / `-c`. Everything else (STT, TTS, silence-gate) is
> harness-agnostic.

Set up or run **voice-chat** — a hands-free, headphones-only voice loop that lets
the user talk to the coding agent with no keyboard. The engine lives in
`scripts/voice/` (entry point `voice-loop.ts`); this skill drives its setup and
launch and explains the knobs.

**The pipeline** (everything local/offline except the LLM call, which rides the
user's existing subscription — flat-rate, full tools, *not* the metered Agent SDK):

```
mic ─(sox rec, silence-gated)─▶ wav ─(whisper.cpp)─▶ text
    ─(<agent> -p --resume)─▶ reply ─(XTTS | Piper | say | espeak-ng)─▶ headphones
```

Turns run sequentially; a sox silence-gate does endpointing (always-on VAD, no
push-to-talk). Headphones are assumed so the agent's voice never re-enters the mic.

### Step 1 — verify dependencies

Always start here. Run the built-in check, which reports exactly what's missing
and is platform-aware:

```bash
node scripts/voice/voice-loop.ts --check
```

It prints the resolved STT model, TTS backend, and `Platform / Recorder / Player`.
If pieces are missing, install them (see Step 2) and re-run until clean.

### Step 2 — install what's missing

Base stack (STT + capture) on every platform:

- **macOS:** `brew install sox whisper-cpp`
- **Linux / WSL:** `sudo apt install sox espeak-ng pulseaudio-utils`, plus a
  `whisper-cli` on PATH (build whisper.cpp or install a prebuilt binary).

Whisper model (once):

```bash
mkdir -p ~/.whisper-models
curl -L -o ~/.whisper-models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

### Step 3 — pick a TTS backend

Set `VOICE_TTS_BACKEND` or leave it `auto` (Piper if installed with a voice →
macOS `say` → `espeak-ng`):

- **`say`** — macOS built-in; voice via `VOICE_TTS_VOICE`.
- **`espeak`** — cross-platform fallback (espeak-ng); tiny, robotic.
- **`piper`** — local neural TTS; point `VOICE_PIPER_MODEL` at a `.onnx` voice.
- **`xtts`** — Coqui XTTS-v2 voice **clone** from a ~6s sample; the richest and
  heaviest (Python + persistent model server), never auto-selected. To use it:
  ```bash
  python3 -m venv ~/.xtts-venv && source ~/.xtts-venv/bin/activate
  pip install -r scripts/voice/requirements.txt
  scripts/voice/fetch-sample.sh          # record a ~6s sample (or VOICE_SAMPLE_URL=… to download)
  VOICE_PYTHON=~/.xtts-venv/bin/python VOICE_TTS_BACKEND=xtts node scripts/voice/voice-loop.ts
  ```

### Step 4 — run it

```bash
node scripts/voice/voice-loop.ts
```

Speak after the pause; quit with `Ctrl-C` or by saying an exit phrase
(`stop listening`, `goodbye agent`, `that's all for now`).

### Configuration

Everything is env-overridable and reversible in one line. Most-used:

| Var | Default | What |
|---|---|---|
| `VOICE_TTS_BACKEND` | `auto` | `say` / `espeak` / `piper` / `xtts` |
| `VOICE_GREETING` / `VOICE_SIGNOFF` | neutral | spoken lines — give the loop a persona without touching code |
| `VOICE_ALLOWED_TOOLS` | `Read,Edit,Write,Bash,Glob,Grep` | agent tool allowlist |
| `VOICE_WHISPER_MODEL` | `~/.whisper-models/ggml-base.en.bin` | STT model |
| `VOICE_PLAYER` | `afplay` (mac) / `paplay` | wav player for piper/xtts |
| `VOICE_START_THRESHOLD` / `VOICE_STOP_SECS` / `VOICE_STOP_THRESHOLD` | `1%` / `1.5` / `1%` | silence-gate feel — the biggest lever |

The full backend matrix, config table, and roadmap (Silero VAD, barge-in,
streaming) live in `scripts/voice/README.md` — read it for anything not covered here.

### Notes

- **Neutral by default; re-flavor via env.** The shipped defaults are persona-free
  (greeting "Ready. I'm listening.", sign-off "Goodbye."). A consumer gives it a
  voice purely through `VOICE_GREETING` / `VOICE_SIGNOFF` / `VOICE_TTS_VOICE`.
- **Free stack.** Every piece is local except the agent call, which uses the
  user's existing subscription — no metered API spend.
- **Cross-platform.** macOS, Linux, and WSL; capture/playback auto-detect the host.
