## Instructions

Install and run **local Whisper** (OpenAI's open speech-to-text model via
[`whisper.cpp`](https://github.com/ggml-org/whisper.cpp)) for offline dictation —
free, private, cross-platform. Transcription runs on the machine; nothing is
sent to a cloud. Use this when the user wants voice input that stays local
(e.g. dictating prompts, or the voice-driven [[diagram]] loop).

The logic lives in `scripts/whisper-*.sh` — call them, do not reimplement.

### Step 1 — detect the platform

```bash
bash scripts/whisper-setup.sh --detect
```

This prints the plan (OS, package manager, model, install dir) with **no side
effects**. macOS and Linux are automated; Windows is guided (a bash installer
can't drive it reliably — the script prints the winget/build steps, and the
user can use the built-in `Win+H` Voice Typing for live in-field dictation).

### Step 2 — install (confirm first — it builds from source)

```bash
bash scripts/whisper-setup.sh [--model base.en]
```

- Installs build deps (`brew` / `apt` / `dnf` / `pacman`), clones `whisper.cpp`,
  and **builds with `-DWHISPER_SDL2=ON`** so the live `whisper-stream` binary is
  guaranteed (bottled packages usually omit it). Then downloads the model.
- Compiling takes a few minutes (one time). It is heavy and modifies the
  machine, so **confirm before running it**. Re-runnable: updates + rebuilds,
  skips an existing model.
- Models: `tiny.en` (fastest) → `base.en` (default, good balance) → `small` /
  `medium` (more accurate, larger). Pick via `--model`.

### Step 3 — use it

When the user invokes `/whisper` (or asks to start live dictation) and it is
already installed, **run it for them** — do not just print the command.

- **Live (see it as you speak)** — *default action on `/whisper`*. Launch it in
  its own terminal window so the user gets the live stream + Ctrl-C:

  ```bash
  bash scripts/whisper-live.sh --terminal
  ```

  `--terminal` opens a new terminal (macOS Terminal via osascript; Linux
  gnome-terminal/konsole/xterm) running `whisper-stream` word-by-word. Without
  `--terminal` it streams in the current terminal.

- **Voice-activated dictation into any prompt (talk → transcribe → clipboard):**

  ```bash
  bash scripts/whisper-dictate.sh [--silence 0.8] [--threshold 2%] [--model base.en]
  ```

  No fixed timer — it listens, starts recording when you speak, and **auto-stops
  after a beat of silence** (sox VAD). Transcribes locally, prints the text and
  copies it to the clipboard (`pbcopy` / `wl-copy` / `xclip` / `clip.exe`).
  Tune `--silence` (trailing-silence seconds) and `--threshold` (noise floor)
  for your mic; `--max <sec>` adds a hard cap.

### Step 4 — cross-platform notes

| OS | Install | Live "as you speak" |
|---|---|---|
| macOS | automated (Homebrew) | `whisper-live.sh`; or macOS Dictation (in-field) |
| Linux | automated (apt/dnf/pacman build) | `whisper-live.sh`; or Speech Note / nerd-dictation |
| Windows | guided (winget + build) | `whisper-stream.exe`; or `Win+H` Voice Typing |

For a polished GUI dictation app instead of the CLI, point macOS users to
superwhisper or MacWhisper, and Windows users to WhisperDesktop or Vibe — those
are release-to-transcribe (not word-by-word live) and some are paid.

## Guardrails

- Local and free: transcription runs on-device; nothing leaves the machine.
- Confirm before the install step (it compiles from source, takes minutes).
- The scripts are the source of truth — the skill calls them, never reimplements
  the install/transcribe logic.
