# VHS Data Codec V14.0

Store digital files on VHS tapes Yes really Up to **~1.97 GB on a single T-160 tape**.

Reed-Solomon RS(255,223) error correction, bit interleaving, guard bands, VHS safety margins, and multi-pass merge for when the tape fights back.

[![GitHub Release](https://img.shields.io/github/v/release/ASDReyiz/vhs-data-codec?style=flat-square)](https://github.com/ASDReyiz/vhs-data-codec/releases/latest)
[![Build & Release](https://github.com/ASDReyiz/vhs-data-codec/actions/workflows/build-release.yml/badge.svg)](https://github.com/ASDReyiz/vhs-data-codec/actions/workflows/build-release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---
## Live Demo
Try it online: https://vhs-data-codec.vercel.app

## ⬇️ Download (Pre-built)

Go to the [Releases](https://github.com/ASDReyiz/vhs-data-codec/releases/latest) page and grab the file for your OS:

| Platform | File |
|----------|------|
| Windows  | `VHS-Data-Codec-*-win-x64.exe` |
| Linux    | `VHS-Data-Codec-*-linux-x64.AppImage` |

> **Linux users:** After downloading the AppImage, make it executable:
> ```bash
> chmod +x VHS-Data-Codec-*.AppImage
> ./VHS-Data-Codec-*.AppImage
> ```

---

## Quick Start (Browser)

```bash
npm install
npm run dev          # → http://localhost:5173
```

## Desktop App (Electron)

```bash
npm install
npm run dev:electron     # dev mode with hot reload + DevTools
npm run build:electron   # → release/ folder with installer
```

Desktop advantages: native save dialogs, no browser blob limits, files of any size, Windows/Mac/Linux installers.

---

## Presets

| Preset   | Block | FPS | Throughput | T-160 Capacity |
|----------|-------|-----|-----------|----------------|
| SAFE     | 8px   | 10  | ~2 KB/s   | ~20 MB         |
| STANDARD | 4px   | 30  | ~52 KB/s  | ~490 MB        |
| EXPRESS  | 3px   | 30  | ~91 KB/s  | ~857 MB        |
| TURBO    | 2px   | 30  | ~216 KB/s | ~1.97 GB       |

## How It Works

1. **ENCODE** → drop file(s), pick preset, save .VHSD + generate AVI
2. **RECORD** → play AVI on TV via media player, record to VHS tape
3. **CAPTURE** → play tape back, capture with USB capture card → MP4
4. **DECODE** → drop MP4, get your files back

## Multi-Pass Merge (for TURBO or damaged tapes)

Record the same tape 2-3 times. Decode each capture → save as .VHSD → drop all into merge zone. Majority-vote across captures + RS error correction = data survives VHS.

## Project Structure

```
.github/
  workflows/
    build-release.yml  # CI/CD — builds exe + AppImage on release tag
src/
  vhs-codec.js         # Core codec — RS, interleaving, frame encode/decode, AVI builder
  VHSCodec.jsx         # React UI — encoder, decoder, self-test, info tabs
  App.jsx              # App wrapper
  main.jsx             # React entry point
electron/
  main.js              # Electron main process — native dialogs, window management
  preload.js           # IPC bridge (contextBridge)
scripts/
  dev-electron.js      # Dev launcher — starts Vite then Electron
index.html             # HTML entry point
package.json           # Dependencies + scripts
vite.config.js         # Vite build config
electron-builder.json  # Desktop installer config
```

## File Formats

- **.vhsd** — Binary archive (32-byte header + compressed payload). Instant encode/decode.
- **.vhsl** — JSON manifest. Human-readable receipt of what's on the tape.
- **.avi** — MJPEG video ready for VHS recording. Single file, any size.

## Building from Source


```bash
npm install
npm run build:electron   # builds for your current OS
```

## License

MIT
