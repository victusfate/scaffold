#!/usr/bin/env python3
# xtts_server.py — persistent Coqui XTTS-v2 voice-clone TTS server for the
# voice loop (scripts/voice/voice-loop.ts, backend "xtts").
#
# Why a server, not a per-call script: XTTS takes several seconds to load. We
# load the model ONCE, print "READY", then answer one synthesis request per
# line of stdin so each spoken turn is just inference, not a cold start.
#
# Protocol (line-oriented, one request at a time — the loop is sequential):
#   stdin : one base64-encoded UTF-8 line per request (base64 so newlines in
#           the agent's reply can't corrupt the framing).
#   stdout: "READY" once the model is loaded; then, per request,
#           "WAV <path>" on success or "ERR <message>" on failure.
#   stderr: human-readable progress/log (inherited by the parent terminal).
#
# A free + local route to a custom cloned voice: XTTS clones the voice in the
# sample at $VOICE_XTTS_SPEAKER (default ~/.xtts-voices/sample.wav, a ~6s clip
# you provide — see fetch-sample.sh). Per Coqui's own docs it clones timbre
# reliably but accent only partially, so fidelity depends on the sample. XTTS-v2
# is under the Coqui Public Model License (non-commercial) — fine for personal use.
#
# Run indirectly via `VOICE_TTS_BACKEND=xtts node scripts/voice/voice-loop.ts`.

import argparse
import base64
import os
import sys
import tempfile


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def emit(line: str):
    print(line, flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--speaker", required=True, help="path to the ~6s voice sample to clone")
    ap.add_argument("--model", default="tts_models/multilingual/multi-dataset/xtts_v2")
    ap.add_argument("--language", default="en")
    args = ap.parse_args()

    if not os.path.exists(args.speaker):
        emit(f"ERR speaker sample not found: {args.speaker}")
        return 1

    # Auto-accept the XTTS model license non-interactively so first run doesn't
    # hang waiting on a prompt. (Personal, non-commercial use.)
    os.environ.setdefault("COQUI_TOS_AGREED", "1")
    # Let unsupported MPS ops fall back to CPU instead of crashing.
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    try:
        from TTS.api import TTS
    except Exception as e:  # noqa: BLE001 - surface any import problem to the caller
        emit(f"ERR cannot import TTS (pip install coqui-tts): {e}")
        return 1

    device = "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            device = "cuda"
        elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device = "mps"
    except Exception:  # noqa: BLE001 - torch optional-detail; default to cpu
        pass

    log(f"[xtts] loading {args.model} on {device} …")
    try:
        tts = TTS(args.model).to(device)
    except Exception as e:  # noqa: BLE001
        emit(f"ERR model load failed: {e}")
        return 1

    tmpdir = tempfile.mkdtemp(prefix="voice-xtts-")
    emit("READY")

    n = 0
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            text = base64.b64decode(raw).decode("utf-8").strip()
        except Exception as e:  # noqa: BLE001
            emit(f"ERR bad input: {e}")
            continue
        if not text:
            continue
        out = os.path.join(tmpdir, f"r{n}.wav")
        n += 1
        try:
            tts.tts_to_file(
                text=text,
                speaker_wav=args.speaker,
                language=args.language,
                file_path=out,
            )
            emit(f"WAV {out}")
        except Exception as e:  # noqa: BLE001
            emit(f"ERR synth failed: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
