#!/usr/bin/env node
// Tests for scripts/voice/voice-loop.ts. Two layers:
//   1. Pure unit tests of chooseTts (the TTS-backend decision) — deterministic,
//      no host tools needed.
//   2. A live smoke test of the real entry point (`--help`) via a subprocess,
//      proving the file parses under Node type-stripping and the CLI is reachable.
// The full audio round-trip (mic → whisper.cpp → TTS) needs sox + whisper.cpp +
// models and is exercised in use, not in CI.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let passed = 0, failed = 0
const assert = (label: string, cond: boolean, detail = ''): void => {
  if (cond) { console.error(`  pass  ${label}`); passed++ }
  else { console.error(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failed++ }
}

const { chooseTts } = await import('./voice-loop.ts')

// 1. Explicit backend always wins over auto-detection.
{
  const caps = { piperReady: true, isMac: true, hasSay: true }
  assert('explicit say wins', chooseTts('say', caps) === 'say')
  assert('explicit espeak wins', chooseTts('espeak', caps) === 'espeak')
  assert('explicit xtts wins', chooseTts('xtts', caps) === 'xtts')
  assert('explicit piper wins', chooseTts('piper', { piperReady: false, isMac: false, hasSay: false }) === 'piper')
}

// 2. auto-detect order: piper > say (mac only) > espeak.
{
  assert('auto → piper when ready',
    chooseTts('auto', { piperReady: true, isMac: true, hasSay: true }) === 'piper')
  assert('auto → say on mac when no piper',
    chooseTts('auto', { piperReady: false, isMac: true, hasSay: true }) === 'say')
  assert('auto → espeak on mac when say missing',
    chooseTts('auto', { piperReady: false, isMac: true, hasSay: false }) === 'espeak')
  assert('auto → espeak on linux (no say even if present-flag)',
    chooseTts('auto', { piperReady: false, isMac: false, hasSay: true }) === 'espeak')
  assert('auto → espeak on bare linux',
    chooseTts('auto', { piperReady: false, isMac: false, hasSay: false }) === 'espeak')
}

// 3. Live entry point: `--help` runs, exits 0, and describes the tool.
{
  const loop = join(dirname(fileURLToPath(import.meta.url)), 'voice-loop.ts')
  const r = spawnSync(process.execPath, [loop, '--help'], { encoding: 'utf8' })
  assert('--help exits 0', r.status === 0, `status=${String(r.status)}`)
  assert('--help names the tool', (r.stdout ?? '').includes('voice-loop'))
  assert('--help does not start recording', !(r.stdout ?? '').includes('listening'))
}

console.error(`\nvoice-loop: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
