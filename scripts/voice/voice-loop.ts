#!/usr/bin/env node
// voice-loop.ts — hands-free, headphones-only voice loop for the coding agent.
//
// The goal: talk to the coding agent with no keyboard. You speak, whisper.cpp
// transcribes, the selected Claude or Codex CLI does the agent work, and a local TTS
// backend speaks the reply back. Headphones make this clean: the agent's own
// voice never leaks into the mic, so no echo cancellation is needed.
//
// Cross-platform (macOS / Linux / WSL): capture and playback auto-detect the
// host — `say`/`afplay` on macOS, `espeak-ng`/`paplay` elsewhere — and every
// choice is env-overridable.
//
// Every piece is local/offline except the LLM call, which uses the selected
// CLI’s authentication and account limits:
//   mic --(sox rec, silence-gated)--> wav
//       --(whisper.cpp local model)--> text
//       --(Claude or Codex CLI)--> reply text
//       --(XTTS clone | Piper model | say | espeak-ng)--> headphones
//
// TTS is pluggable (VOICE_TTS_BACKEND): 'say' (macOS built-in), 'espeak'
// (espeak-ng, cross-platform), 'piper' (local neural model), or 'xtts' (a
// genuine voice-clone via a persistent Python server — see
// scripts/voice/xtts_server.py). A sox silence-gate handles endpointing and
// turns run sequentially. Roadmap (README): Silero VAD, barge-in, streaming.
//
// Self-contained tool: everything it needs lives in this scripts/voice/ dir
// (this entry, xtts_server.py, requirements.txt, README.md), so it can later be
// lifted into its own repo with a single move.
//
// Run:   node scripts/voice/voice-loop.ts
// Check: node scripts/voice/voice-loop.ts --check   (verify deps, then exit)
// Quit:  Ctrl-C, or say one of the EXIT_PHRASES.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentConfig, askAgent } from './agent.ts'

// ---- Config (env-overridable; all reversible in one line) -------------------

// Host platform, resolved once. Drives the cross-platform defaults below so the
// same loop runs on macOS, Linux, and WSL without edits.
const PLATFORM = process.platform
const IS_MAC = PLATFORM === 'darwin'

const CFG = {
  // STT
  whisperBin: process.env.VOICE_WHISPER_BIN ?? 'whisper-cli',
  whisperModel:
    process.env.VOICE_WHISPER_MODEL ??
    join(homedir(), '.whisper-models', 'ggml-base.en.bin'),

  // TTS backend — 'auto' prefers a local neural model (Piper) when it and a
  // voice are installed, else macOS `say`, else `espeak-ng` (cross-platform).
  // Force one with VOICE_TTS_BACKEND=say|espeak|piper|xtts. 'xtts' is the
  // genuine voice-clone (Python; never auto-selected since it is heavier/slower).
  ttsBackend: process.env.VOICE_TTS_BACKEND ?? 'auto',
  // `say` voice (macOS only). Karen is Australian — a ready-made non-US accent.
  // `say -v '?'` lists installed voices.
  ttsVoice: process.env.VOICE_TTS_VOICE ?? 'Karen',
  ttsRate: process.env.VOICE_TTS_RATE ?? '', // words/min; empty = system default
  // espeak-ng — tiny cross-platform formant synth; the portable fallback on
  // Linux/WSL (and anywhere `say` is absent). `brew install espeak-ng` /
  // `apt install espeak-ng`.
  espeakBin: process.env.VOICE_ESPEAK_BIN ?? 'espeak-ng',
  // Piper — local neural TTS model. en_GB is the closest ready-made accent Piper
  // ships (no en_AU/en_NZ voice exists in Piper).
  piperBin: process.env.VOICE_PIPER_BIN ?? 'piper',
  piperModel:
    process.env.VOICE_PIPER_MODEL ??
    join(homedir(), '.piper-voices', 'en_GB-alba-medium.onnx'),
  // Audio player — macOS ships `afplay`; PulseAudio's `paplay` is the Linux/WSL
  // default (override with VOICE_PLAYER, e.g. `aplay` for ALSA).
  player: process.env.VOICE_PLAYER ?? (IS_MAC ? 'afplay' : 'paplay'),
  // XTTS — Coqui XTTS-v2 voice clone: a free/local route to a custom voice.
  // Runs as a persistent Python server (loads the model once) and clones from a
  // ~6s speaker sample. Slower than Piper/say. See fetch-sample.sh for one way
  // to get one; supply any ~6s .wav via VOICE_XTTS_SPEAKER.
  python: process.env.VOICE_PYTHON ?? 'python3',
  xttsModel:
    process.env.VOICE_XTTS_MODEL ?? 'tts_models/multilingual/multi-dataset/xtts_v2',
  xttsSpeaker:
    process.env.VOICE_XTTS_SPEAKER ?? join(homedir(), '.xtts-voices', 'sample.wav'),
  xttsLang: process.env.VOICE_XTTS_LANG ?? 'en',

  // Spoken lines — neutral by default; give the loop a persona via env without
  // touching code. VOICE_GREETING plays once at startup; VOICE_SIGNOFF on exit.
  greeting: process.env.VOICE_GREETING ?? "Ready. I'm listening.",
  signoff: process.env.VOICE_SIGNOFF ?? 'Goodbye.',

  // Endpointing — sox `silence` effect. Start on sound; stop after trailing
  // quiet. Thresholds are % of full scale; laptop mics sit low, so 1% catches
  // normal speech onset while staying above room noise (~0.4%). Raise stopSecs
  // if it cuts you off mid-thought; lower for snappier turns. Biggest lever on
  // how the loop "feels".
  // quality-ok: magic-number — 16 kHz mono, whisper.cpp's input rate
  sampleRate: 16000,
  startThreshold: process.env.VOICE_START_THRESHOLD ?? '1%',
  stopSecs: process.env.VOICE_STOP_SECS ?? '1.5',
  stopThreshold: process.env.VOICE_STOP_THRESHOLD ?? '1%',
  minChars: 2, // ignore blips shorter than this after transcription
  // Live level meter while recording (sox -S on stderr) so you can SEE it hear
  // you. Only visible when the loop runs in a foreground terminal.
  // VOICE_METER=0 silences it.
  meter: (process.env.VOICE_METER ?? '1') !== '0',

  exitPhrases: ['stop listening', 'goodbye agent', "that's all for now"],
}

// ---- Small helpers ----------------------------------------------------------

// TTS backend resolved once at startup, plus the temp dir Piper writes into.
let ACTIVE_TTS = 'say'
let SPEAK_DIR = ''
const SCRIPT_DIR = dirname(process.argv[1] ?? '.')

// Persistent XTTS server state (only used when ACTIVE_TTS === 'xtts').
let XTTS_PROC: ChildProcess | null = null
let xttsPending: ((line: string) => void) | null = null
let xttsBuf = ''

// Is `bin` on PATH? Pass bin as a positional arg to `sh` (not interpolated into
// the script) so there's no injection and no shell-arg deprecation warning.
const have = (bin: string) =>
  spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', '_', bin], {
    stdio: 'ignore',
  }).status === 0

/**
 * Pure TTS-backend decision (exported for tests): an explicit backend wins;
 * otherwise auto-detect in order Piper (installed + voice) > macOS `say` >
 * `espeak-ng` (the portable fallback).
 */
export function chooseTts(
  backend: string,
  caps: { piperReady: boolean; isMac: boolean; hasSay: boolean },
): string {
  if (backend !== 'auto') return backend
  if (caps.piperReady) return 'piper'
  if (caps.isMac && caps.hasSay) return 'say'
  return 'espeak'
}

/** Resolve the TTS backend against the live host (probes PATH and the model). */
function resolveTts(): string {
  return chooseTts(CFG.ttsBackend, {
    piperReady: have(CFG.piperBin) && existsSync(CFG.piperModel),
    isMac: IS_MAC,
    hasSay: have('say'),
  })
}

/**
 * Boot the persistent XTTS Python server: loads the model once, then answers
 * one synthesis request per line. Resolves when it prints READY.
 */
function startXtts(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = join(SCRIPT_DIR, 'xtts_server.py')
    const proc = spawn(
      CFG.python,
      [server, '--speaker', CFG.xttsSpeaker, '--model', CFG.xttsModel, '--language', CFG.xttsLang],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    )
    XTTS_PROC = proc
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code && code !== 0) reject(new Error(`xtts server exited (${code})`))
    })
    proc.stdout!.setEncoding('utf8')
    proc.stdout!.on('data', (chunk: string) => {
      xttsBuf += chunk
      let nl: number
      while ((nl = xttsBuf.indexOf('\n')) >= 0) {
        const line = xttsBuf.slice(0, nl).trim()
        xttsBuf = xttsBuf.slice(nl + 1)
        if (line === 'READY') { resolve(); continue }
        if (xttsPending) { const r = xttsPending; xttsPending = null; r(line) }
      }
    })
  })
}

/** One XTTS synthesis request; resolves with the server's reply line. */
function xttsRequest(text: string): Promise<string> {
  return new Promise((resolve) => {
    xttsPending = resolve
    XTTS_PROC!.stdin!.write(Buffer.from(text, 'utf8').toString('base64') + '\n')
  })
}

/** Speak text through the active local TTS backend (XTTS, Piper, or `say`). */
async function speak(text: string): Promise<void> {
  if (ACTIVE_TTS === 'xtts') {
    const line = await xttsRequest(text)
    if (line.startsWith('WAV ')) spawnSync(CFG.player, [line.slice(4)], { stdio: 'ignore' })
    else console.error('  (xtts) ' + line)
    return
  }
  if (ACTIVE_TTS === 'piper') {
    const wav = join(SPEAK_DIR, 'reply.wav')
    spawnSync(CFG.piperBin, ['-m', CFG.piperModel, '-f', wav], { input: text })
    spawnSync(CFG.player, [wav], { stdio: 'ignore' })
    return
  }
  if (ACTIVE_TTS === 'espeak') {
    // espeak-ng plays straight to the default audio device — no player needed.
    spawnSync(CFG.espeakBin, [text], { stdio: 'ignore' })
    return
  }
  const args = ['-v', CFG.ttsVoice]
  if (CFG.ttsRate) args.push('-r', CFG.ttsRate)
  args.push(text)
  spawnSync('say', args, { stdio: 'ignore' })
}

// ---- Dependency check -------------------------------------------------------

function checkDeps(): string[] {
  const agent = agentConfig()
  const problems: string[] = []
  if (!have('rec') && !have('sox'))
    problems.push('sox (mic capture) — install: brew install sox')
  if (!have(CFG.whisperBin))
    problems.push(
      `${CFG.whisperBin} (STT) — install: brew install whisper-cpp`,
    )
  if (!existsSync(CFG.whisperModel))
    problems.push(
      `whisper model not found at ${CFG.whisperModel} — download a ggml model, e.g.\n` +
        '     mkdir -p ~/.whisper-models && curl -L -o ~/.whisper-models/ggml-base.en.bin \\\n' +
        '       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    )
  if (!have(agent.binary))
    problems.push(`${agent.binary} (agent) — ${agent.name} CLI must be on PATH`)

  // Platform-aware hint for the audio player these backends pipe wavs through.
  const playerHint = IS_MAC
    ? 'macOS ships afplay'
    : 'install one (e.g. apt install pulseaudio-utils for paplay) or set VOICE_PLAYER'

  const tts = resolveTts()
  if (tts === 'piper') {
    if (!have(CFG.piperBin))
      problems.push(`${CFG.piperBin} (TTS) — install Piper; see scripts/voice/README.md`)
    if (!existsSync(CFG.piperModel))
      problems.push(`Piper voice not found at ${CFG.piperModel} — download an en_GB .onnx (see README)`)
    if (!have(CFG.player)) problems.push(`${CFG.player} (audio player) — ${playerHint}`)
  } else if (tts === 'xtts') {
    if (!have(CFG.python)) {
      problems.push(`${CFG.python} (XTTS) — Python 3.10+ required`)
    } else if (spawnSync(CFG.python, ['-c', 'import TTS'], { stdio: 'ignore' }).status !== 0) {
      problems.push('coqui-tts not importable — pip install coqui-tts (see README)')
    }
    if (!existsSync(CFG.xttsSpeaker))
      problems.push(`XTTS speaker sample not found at ${CFG.xttsSpeaker} — add a ~6s .wav (see README)`)
    if (!have(CFG.player)) problems.push(`${CFG.player} (audio player) — ${playerHint}`)
  } else if (tts === 'espeak') {
    if (!have(CFG.espeakBin))
      problems.push(`${CFG.espeakBin} (TTS) — install espeak-ng (brew install espeak-ng / apt install espeak-ng)`)
  } else if (!have('say')) {
    problems.push('say (TTS) — macOS only; on Linux/WSL install espeak-ng or Piper (see README)')
  }
  return problems
}

// ---- Loop steps -------------------------------------------------------------

/** Record one utterance to a wav, returning when sox detects trailing silence. */
function recordUtterance(wav: string): Promise<void> {
  const recBin = have('rec') ? 'rec' : 'sox'
  const pre = recBin === 'sox' ? ['-d'] : [] // `sox -d` reads the default mic
  // -S shows a live VU meter on stderr (feedback); -q silences it.
  const args = [
    ...pre,
    CFG.meter ? '-S' : '-q',
    '-c', '1',
    '-r', String(CFG.sampleRate),
    '-b', '16',
    wav,
    // silence: start when sound exceeds threshold; stop after stopSecs quiet.
    'silence', '1', '0.1', CFG.startThreshold,
    '1', CFG.stopSecs, CFG.stopThreshold,
  ]
  return new Promise((resolve, reject) => {
    // Inherit stderr so the meter is visible when run in a foreground terminal.
    const p = spawn(recBin, args, { stdio: ['ignore', 'ignore', CFG.meter ? 'inherit' : 'ignore'] })
    p.on('error', reject)
    p.on('close', () => resolve())
  })
}

/** Transcribe a wav with whisper.cpp; returns the plain text (no timestamps). */
function transcribe(wav: string): string {
  const r = spawnSync(
    CFG.whisperBin,
    ['-m', CFG.whisperModel, '-f', wav, '-nt', '-np', '-l', 'en'],
    { encoding: 'utf8' },
  )
  return (r.stdout ?? '').replace(/\s+/g, ' ').trim()
}

// ---- Main -------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(
      'voice-loop — hands-free voice loop for the coding agent.\n' +
        '  node scripts/voice/voice-loop.ts          start the loop\n' +
        '  node scripts/voice/voice-loop.ts --check  verify deps and exit\n' +
        '  env: VOICE_TTS_BACKEND, VOICE_GREETING, VOICE_WHISPER_MODEL, VOICE_AGENT=claude|codex, ...',
    )
    return
  }

  const agent = agentConfig()
  const problems = checkDeps()
  if (problems.length) {
    console.error('Voice loop is missing some pieces:\n')
    for (const p of problems) console.error('  - ' + p)
    console.error('\nFix those, then re-run. See scripts/voice/README.md.')
    process.exit(1)
  }
  if (argv.includes('--check')) {
    const tts = resolveTts()
    const voice =
      tts === 'piper' ? CFG.piperModel
      : tts === 'xtts' ? `xtts clone of ${CFG.xttsSpeaker}`
      : tts === 'espeak' ? CFG.espeakBin
      : `say -v ${CFG.ttsVoice}`
    const recorder = have('rec') ? 'rec' : 'sox'
    console.log(`All voice-loop deps present. STT: ${CFG.whisperModel} | TTS: ${tts} (${voice})`)
    console.log(`Agent: ${agent.name} (${agent.binary}). Platform: ${PLATFORM}. Recorder: ${recorder}. Player: ${CFG.player}.`)
    return
  }

  const dir = mkdtempSync(join(tmpdir(), 'voice-loop-'))
  const wav = join(dir, 'utt.wav')
  SPEAK_DIR = dir
  ACTIVE_TTS = resolveTts()
  const cleanup = () => {
    try { XTTS_PROC?.kill() } catch { /* already gone */ }
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
  process.on('SIGINT', () => { console.log('\nCiao.'); cleanup(); process.exit(0) })

  if (ACTIVE_TTS === 'xtts') {
    console.log('Loading XTTS voice model (first run downloads ~1.8GB)…')
    await startXtts()
  }

  let sessionId: string | null = null
  await speak(CFG.greeting)
  console.log(`voice loop [TTS: ${ACTIVE_TTS}] — speak after the pause. Ctrl-C to quit.\n`)

  while (true) {
    process.stdout.write('\n🎙  listening — speak now (live level below):\n')
    await recordUtterance(wav)
    const heard = transcribe(wav)
    if (heard.length < CFG.minChars) { console.log('(nothing)'); continue }
    console.log(`\n  you: ${heard}`)

    if (CFG.exitPhrases.some((p) => heard.toLowerCase().includes(p))) {
      await speak(CFG.signoff)
      break
    }

    process.stdout.write('  agent is working…')
    const { reply, sessionId: sid } = askAgent(agent, heard, sessionId)
    sessionId = sid
    console.log(`\n  agent: ${reply}\n`)
    await speak(reply)
  }
  cleanup()
}

// Run the loop only when invoked directly — importing the module (e.g. from the
// test) must not start recording.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => { console.error(e); process.exit(1) })
}
