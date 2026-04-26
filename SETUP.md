# Gemma4kids — Setup Guide

**Gemma4kids** is a fully offline AI coding teacher for kids aged 8–12.
There is no cloud, no subscription, and no internet required after setup.

---

## Requirements

| | |
|---|---|
| OS | Windows 10/11 · macOS 12+ · Ubuntu 20.04+ |
| RAM | 32 GB recommended (Gemma 26B needs ~17 GB VRAM/RAM) |
| Disk | ~30 GB free (models + app) |
| GPU | NVIDIA GPU with 16+ GB VRAM strongly recommended |

---

## Step 1 — Install Ollama

Download and install **Ollama** (the local AI runtime) for your platform:

- **Windows / macOS / Linux:** https://ollama.com/download

After installing, verify it is running:

```bash
ollama list
```

---

## Step 2 — Download the Gemma models

Open a terminal and run **both** commands:

```bash
# Required — code generation (≈17 GB download)
ollama pull gemma4:26b

# Optional — voice input via microphone (≈9.6 GB download)
ollama pull gemma4:e4b
```

> Voice input is disabled automatically if `gemma4:e4b` is not installed.
> The app still works fully via typed prompts without it.

---

## Step 3 — Install Gemma4kids

### Windows
Run the `Gemma4kids-Setup-*.exe` installer.
> ⚠️ **Windows SmartScreen warning:** The app is unsigned. Click **"More info" → "Run anyway"** to proceed. This is safe — the app makes zero network calls except to Ollama on `localhost:11434`.

### macOS
Open the `.dmg`, drag **Gemma4kids** to Applications.
> ⚠️ **Gatekeeper warning:** Right-click the app → **Open** → **Open** on the first launch.

### Linux
Make the AppImage executable and run it:
```bash
chmod +x Gemma4kids-*.AppImage
./Gemma4kids-*.AppImage
```

---

## Step 4 — Launch

1. Make sure Ollama is running (it starts automatically on Windows/macOS after install).
2. Open **Gemma4kids**.
3. The app checks for Gemma on startup — if it shows a sleeping robot, Ollama isn't running yet.

---

## How it works

```
Child speaks or types → Gemma generates HTML animation → saved to ~/Documents/KidAnimations/
                       → code appears in the editor → "Open in Browser" shows it live
```

- All processing is **local** — works with WiFi off.
- Animations are saved as standalone `.html` files in `~/Documents/KidAnimations/`.
- Clicking a saved project in the sidebar reloads it into the editor.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Gemma is sleeping!" on launch | Start Ollama: run `ollama serve` in a terminal |
| "Gemma needs a download!" on launch | Run `ollama pull gemma4:26b` |
| Mic button greyed out | Run `ollama pull gemma4:e4b` |
| App crashes on first voice attempt | Wait 10 seconds and try again (VRAM is clearing) |
| Slow responses | Normal — Gemma 26B on CPU can take 30–60 s per response |

---

*Built for the Google Gemma 4 Good Hackathon · Kaggle 2026*
