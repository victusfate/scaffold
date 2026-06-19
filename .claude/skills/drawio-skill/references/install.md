# Installing the draw.io desktop CLI (per OS)

The skill exports diagrams by shelling out to the **draw.io desktop app**, which
ships a CLI. Install it for your platform, then verify with `--version`. The CLI
binary is usually `drawio` (Homebrew cask, jgraph `.deb`/`.rpm`, Arch AUR); some
builds expose `draw.io` instead.

## macOS

```bash
brew install --cask drawio
drawio --version
# If installed by drag-and-drop (no cask wrapper on PATH):
/Applications/draw.io.app/Contents/MacOS/draw.io --version
```

## Windows

Download and run the installer from
<https://github.com/jgraph/drawio-desktop/releases>.

```powershell
"C:\Program Files\draw.io\draw.io.exe" --version   # use full path if not on PATH
```

## Linux (desktop / has a display)

Download the `.deb` or `.rpm` from
<https://github.com/jgraph/drawio-desktop/releases> and install it:

```bash
sudo apt install ./drawio-amd64-<version>.deb      # Debian/Ubuntu
sudo dnf install ./drawio-x86_64-<version>.rpm      # Fedora/RHEL
drawio --version
```

**Do not install via snap** — its AppArmor sandbox denies keyring/secrets access
on servers and crashes the CLI.

## Linux headless (cloud containers, CI, remote/mobile dev)

The CLI is an Electron app, so it needs an X display even for `--export`. On a
box with no `$DISPLAY` (the common case for cloud containers and the mobile/remote
dev workflow), install a virtual framebuffer and wrap **every** invocation with
`xvfb-run -a`:

```bash
sudo apt install xvfb                       # Debian/Ubuntu
# or: sudo dnf install xorg-x11-server-Xvfb # Fedora/RHEL

xvfb-run -a drawio --version
xvfb-run -a drawio -x -f png -o out.png in.drawio
```

Heuristic: if `drawio` exits abnormally with a display/session/Electron-startup
error, you're headless — retry once under `xvfb-run -a` before falling back to
the browser-fallback URL (`scripts/encode_drawio_url.py`) or XML-only output.

| Platform | Extra step |
|----------|------------|
| macOS | none after the cask install |
| Windows | use the full `.exe` path if not on PATH |
| Linux (desktop) | `.deb`/`.rpm`, not snap |
| Linux (headless) | install `xvfb`, prefix commands with `xvfb-run -a` |
