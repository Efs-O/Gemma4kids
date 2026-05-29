# Piper TTS on macOS ARM64 — Debug Findings

**Date:** 2026-05-29  
**Instance:** EC2 mac2-m2.metal (i-0a8626e04ef5f69db), macOS 26.3.1 (Darwin arm64)  
**Branch:** post-deadline-fixes

---

## Root Cause Chain

### 1. The rhasspy binary is mislabeled

`piper/mac/aarch64/piper_macos_aarch64.tar.gz` from rhasspy/piper `2023.11.14-2`
contains an **x86_64** executable despite the `aarch64` filename.

```
$ file piper/piper
piper/piper: Mach-O 64-bit executable x86_64   ← wrong arch
```

On an M2 this fails immediately: `zsh: bad CPU type in executable`

### 2. Even if architecture matched, dylibs are missing

The rhasspy macOS archive (both aarch64 and x64, 18 MB each) omits the three
required dynamic libraries that the binary links against via `@rpath`:

| Library | Required version | In archive? |
|---|---|---|
| `libespeak-ng.1.dylib` | 1.52.0 | ✗ |
| `libpiper_phonemize.1.dylib` | 1.2.0 | ✗ |
| `libonnxruntime.1.14.1.dylib` | 1.14.1 | ✗ |

Homebrew has `espeak-ng 1.52.0` and `onnxruntime 1.26.0` but **not 1.14.1**.
`libpiper_phonemize` is not in Homebrew at all.

The Linux archives (25 MB) include all dylibs. macOS archives never did.
This is a known open issue: rhasspy/piper#404, #523.

### 3. History of attempts in this repo

| Commit | Fix attempted | Outcome |
|---|---|---|
| `64e5860` | Runtime `chmod 0755` before spawn (EACCES) | Fixed permissions, hit dylib wall |
| `f810240` | `recursiveFindBinary` returned dir not file | Fixed lookup |
| `27d87af` | Universal DMG, aarch64 CI extraction | Still hit dylib wall |
| `d97977d` | `assertUsablePiperBinary` check | Reverted — redundant |
| `bb74d0d` | **Abandoned Piper on macOS, switched to `say`** | Worked, but Melina/Samantha quality |

### 4. OHF-voice/piper1-gpl — dead end for standalone use

`piper_tts-1.4.2-cp39-abi3-macosx_11_0_arm64.whl` is a Python extension module
(`espeakbridge.so` only). Cannot be spawned from Node.js. No Python in this project.

---

## Solution Found

**`itsabhishekolkha/piper-arm-build` v1.2.0**

File: `piper-arm64-some.deps.deps` (45 MB)  
URL: https://github.com/itsabhishekolkha/piper-arm-build/releases/download/v1.2.0/piper-arm64-some.deps.deps

```
$ file piper-arm64.bin
Mach-O 64-bit executable arm64   ← correct

$ otool -L piper-arm64.bin
/usr/lib/libSystem.B.dylib        ← system only — self-contained
/usr/lib/libz.1.dylib

$ echo "Γεια!" | piper-arm64.bin --model el_GR-joy-medium.onnx --output_file /tmp/test.wav
Audio successfully generated: /tmp/test.wav   ← exit 0, 85 KB WAV
```

All three languages confirmed working with bundled voices:
- `el_GR-joy-medium.onnx` — Greek ✓
- `en_US-amy-medium.onnx` — English ✓  
- `de_DE-eva_k-x_low.onnx` — German ✓

### Interface difference from rhasspy piper

| | rhasspy binary | arm-build binary |
|---|---|---|
| Output flag | `--output-raw` (raw PCM → stdout) | `--output_file /path/to.wav` (WAV → file) |
| Input | stdin | stdin |
| WAV header | caller builds manually | binary writes complete WAV |

`ttsMain.ts` adapted: macOS uses `speakWithPiperFile()` (temp-file approach,
same pattern as `speakWithSay`). `say` kept as fallback if binary not found.

### Known limitation

The binary is a **PyInstaller bundle** (Python + C++ packaged together). On first
invocation there is a ~1-2 s startup while PyInstaller unpacks its environment to
`/tmp/_MEI…`. Subsequent calls in the same process are fast. This is acceptable
for a demo but would need a proper C++ static build for production.

---

## Files Changed

| File | Change |
|---|---|
| `piper/mac/aarch64/piper` | New: arm64 self-contained piper binary (replaces broken x86_64 archive path) |
| `src/main/ttsMain.ts` | Added `speakWithPiperFile()`; macOS now tries Piper first, falls back to `say` |
| `esbuild.config.mjs` | Previously fixed: `GEMMA.png` unconditional copy from `assets/icons/512x512.png` |
