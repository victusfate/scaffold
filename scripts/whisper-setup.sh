#!/usr/bin/env bash
# whisper-setup — install whisper.cpp (free, local, open speech-to-text) with a
# model, cross-platform.
# Why: a self-run, offline alternative to cloud dictation. Builds from source
# with SDL2 so the live `whisper-stream` binary (word-by-word as you speak) is
# guaranteed — bottled packages usually omit it. macOS + Linux are automated;
# Windows prints guided steps (a bash installer cannot drive it reliably).
# Usage:
#   bash scripts/whisper-setup.sh [--model base.en] [--detect]
#     --model <name>  ggml model (default base.en; e.g. tiny.en, small, medium)
#     --detect        print the plan for this OS and exit (no side effects)
# Re-runnable: updates the repo, rebuilds, and skips an already-downloaded model.
set -euo pipefail

MODEL="base.en"
DETECT=0
for ((i = 1; i <= $#; i++)); do
  arg="${!i}"
  case "$arg" in
    --model) i=$((i + 1)); MODEL="${!i}" ;;
    --detect) DETECT=1 ;;
    *) echo "whisper-setup: unknown option: $arg" >&2; exit 2 ;;
  esac
done

INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/whisper.cpp"
REPO="https://github.com/ggml-org/whisper.cpp.git"
MODEL_FILE="$INSTALL_DIR/models/ggml-$MODEL.bin"
CLI="$INSTALL_DIR/build/bin/whisper-cli"
STREAM="$INSTALL_DIR/build/bin/whisper-stream"

die() { echo "whisper-setup: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux) echo "linux" ;;
    MINGW* | MSYS* | CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

# Print the package manager + dep-install command for the current OS.
deps_plan() {
  local os="$1"
  if [ "$os" = "macos" ]; then
    echo "brew install cmake sdl2 sox git curl"
  elif [ "$os" = "linux" ]; then
    if have apt-get; then echo "sudo apt-get install -y build-essential cmake libsdl2-dev sox git curl"
    elif have dnf; then echo "sudo dnf install -y gcc-c++ cmake SDL2-devel sox git curl"
    elif have pacman; then echo "sudo pacman -S --needed --noconfirm base-devel cmake sdl2 sox git curl"
    else echo "(no known package manager — install: a C++ toolchain, cmake, SDL2 dev headers, sox, git, curl)"
    fi
  fi
}

install_deps() {
  local os="$1"
  if [ "$os" = "macos" ]; then
    have brew || die "Homebrew required on macOS — https://brew.sh"
    brew list cmake >/dev/null 2>&1 && brew list sdl2 >/dev/null 2>&1 && brew list sox >/dev/null 2>&1 || brew install cmake sdl2 sox
  else
    # shellcheck disable=SC2091
    eval "$(deps_plan "$os")"
  fi
}

build_whisper() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "whisper.cpp present — updating"; git -C "$INSTALL_DIR" pull --ff-only || true
  else
    echo "cloning whisper.cpp -> $INSTALL_DIR"; git clone --depth 1 "$REPO" "$INSTALL_DIR"
  fi
  echo "building (SDL2 on, for live whisper-stream)"
  cmake -S "$INSTALL_DIR" -B "$INSTALL_DIR/build" -DWHISPER_SDL2=ON -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$INSTALL_DIR/build" -j --config Release >/dev/null
  [ -x "$STREAM" ] || echo "whisper-setup: warning — whisper-stream not built (SDL2 missing?); whisper-cli still works" >&2
}

download_model() {
  if [ -f "$MODEL_FILE" ]; then echo "model ggml-$MODEL.bin present — skipping"; return; fi
  echo "downloading model: $MODEL"
  bash "$INSTALL_DIR/models/download-ggml-model.sh" "$MODEL"
}

OS="$(detect_os)"

if [ "$DETECT" = 1 ]; then
  echo "os: $OS"
  echo "model: $MODEL"
  echo "install_dir: $INSTALL_DIR"
  echo "deps: $(deps_plan "$OS")"
  echo "live_binary: $STREAM"
  echo "cli_binary: $CLI"
  exit 0
fi

case "$OS" in
  macos | linux)
    install_deps "$OS"
    build_whisper
    download_model
    echo ""
    echo "whisper-setup: done."
    echo "  file transcription : $CLI -m $MODEL_FILE -f audio.wav"
    echo "  live (as you speak): $STREAM -m $MODEL_FILE -t 6 --step 500 --length 5000"
    echo "  or run             : bash scripts/whisper-live.sh"
    ;;
  windows)
    cat <<'EOF'
whisper-setup: Windows is guided (a bash installer can't drive it reliably).
  1. winget install Kitware.CMake Git.Git Ninja-build.Ninja
  2. Get SDL2 dev libs (vcpkg: `vcpkg install sdl2`, or the SDL2 release).
  3. git clone https://github.com/ggml-org/whisper.cpp
  4. cmake -B build -DWHISPER_SDL2=ON ; cmake --build build --config Release
  5. bash whisper.cpp/models/download-ggml-model.sh base.en
  6. Live:  build\bin\whisper-stream.exe -m models\ggml-base.en.bin
  Or use the built-in Win+H Voice Typing for live in-field dictation.
EOF
    ;;
  *) die "unsupported OS: $(uname -s)" ;;
esac
