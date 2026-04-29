# Gemma4kids — Setup Guide

Fully **offline-first**: after Ollama and models are installed, the app talks only to **`http://localhost:11434`** (and optional **local Piper** for read-aloud). No cloud subscriptions.

---

## Requirements

| | |
|---|---|
| **OS** | Windows 10/11 · macOS 12+ · Ubuntu 20.04+ |
| **RAM / VRAM** | See **Hardware Guide** below — varies by model choice. |
| **Disk** | ~4–30 GB free depending on which models you pull. |
| **Network** | For **setup pulls** only (`ollama pull`). Not required during normal kid use once models exist. |

---

## Hardware Guide — Which model should I use?

Gemma4kids lets you choose which Gemma model generates animations. Pick based on your computer:

| Model | Size | Minimum GPU VRAM | Minimum RAM (CPU mode) | Best for |
|---|---|---|---|---|
| `gemma4:26b` | ~17 GB | 20 GB VRAM | Not recommended | Workstation / gaming GPU — best animation quality |
| `gemma4:e4b` | ~6 GB | 8 GB VRAM | 16 GB RAM | Most modern laptops with a dedicated GPU |
| `gemma4:e2b` | ~2.5 GB | 4 GB VRAM | 8 GB RAM | **Older laptops, school computers, integrated graphics** |

### What if I don't have a GPU?
Ollama will use your CPU instead. It still works — animations will just take **30–90 seconds** to generate instead of 5–15. The `gemma4:e2b` model is the most practical choice for CPU-only machines.

### Signs your machine is running low on memory
- Ollama crashes or the app shows an error during generation
- Your computer fan runs at full speed and the system slows down
- Generation never finishes

**Solution:** Switch to a lighter model in the model selector (e2b → e4b → 26b, lightest first), or close other apps to free RAM before generating.

### Voice transcription (mic button)
The mic button always uses `gemma4:e4b` regardless of which coding model is selected. On machines with less than 8 GB VRAM, Ollama may need to unload the coding model first, then load e4b — this causes a 10–30 second pause before transcription starts. This is normal.

---

---

## Step 1 — Install Ollama

Install from **[ollama.com/download](https://ollama.com/download)**.

```bash
ollama list   # confirms the daemon responds
```

---

## Step 2 — Pull Gemma 4 variants

### Best experience (workstation with a good GPU)
```bash
ollama pull gemma4:26b   # main coding model — richest animations
ollama pull gemma4:e4b   # required for mic / voice input
```

### Good laptop or older desktop
```bash
ollama pull gemma4:e4b   # coding + mic voice input
```

### Older computer or school machine (4–8 GB RAM / integrated GPU)
```bash
ollama pull gemma4:e2b   # lightest model — works on older hardware
ollama pull gemma4:e4b   # add this too if you also want mic input
```

**Notes:**
- If **`gemma4:e4b` is missing** → mic button stays disabled; typing always works.
- The **Coding model** selector in the header auto-picks the best available model at launch: prefers `gemma4:26b` → `gemma4:e4b` → `gemma4:e2b` → any other Gemma variant → first model found.
- Voice STT always uses `gemma4:e4b` regardless of which coding model is selected.

---

## Step 3 — Install the app

### Windows  
Run **`Gemma4kids-Setup-*.exe`**. Unsigned build: **More info → Run anyway**.

### macOS  
Open the **`.dmg`**, drag **Gemma4kids** to Applications → first launch via **Right‑click → Open**.

### Linux  
```bash
chmod +x Gemma4kids-*.AppImage && ./Gemma4kids-*.AppImage
```

### From Git (developers)

```bash
git clone https://github.com/Efs-O/Gemma4kids.git
cd Gemma4kids
npm install
npm run dev           # bundles + Electron window
npm run build
npm run typecheck     # strict TS
```

Installer outputs: **`npm run dist:win`** / **`dist:mac`** / **`dist:linux`** (see `electron-builder.yml`).

---

## Step 4 — Launch checklist

1. **Ollama** running (`ollama serve` if needed).
2. Open **Gemma4kids** — startup probes **`/api/tags`**.
3. If you see **“Gemma is sleeping!”** → start Ollama, then **Check again**.
4. If **“Gemma needs a download!”** → run **`ollama pull gemma4:26b`** (and **`gemma4:e4b`** if you want mic + full pairing).

---

## Optional — Piper read-aloud (“Read”)

Assistant bubbles can run **local neural TTS** if the **main** process finds:

1. **`piper`** executable: `piper/piper.exe` (Windows) or `piper/piper` next to packaged resources, **or** under Electron **`userData/piper/`**.
2. **`voices/*.onnx`** + matching **`*.onnx.json`** (same folder naming).

The repo **`.gitignore`** excludes large **`piper/`** and **`voices/`** drops; clone from source and add them locally, or use project scripts such as **`npm run download-voices`** / **`scripts/download-voices.mjs`** per your setup. Without Piper/ONNX, **Read** buttons no-op quietly.

---

## How it behaves

| Feature | Detail |
|---|---|
| **Saves** | `Documents/KidAnimations/<name>.html` — collisions get **`-2`**, **`-3`**, … suffixes. |
| **Delete** | Trash icon beside a project → confirm → file removed from disk. |
| **Browser** | **Open in Browser** uses `file://…` in the **default OS browser** (never an in-app `<iframe>`). |
| **Thinking** | **Think** toggles reasoning for the **coding** model; STT stays **without** thinking; **Show Thoughts** reveals the model scratchpad when present. |
| **Read aloud** | Every assistant bubble has a **Read** button — plays the reply through local Piper TTS (requires optional Piper setup below). |
| **Code Runner** | Mini-game appears only when the **selected coding model** is a **`gemma4:26b*`** tag **and** a reply is streaming. Space to jump; high score saved locally. |
| **HTML repair** | Small automatic fixes apply on tool saves / post-stream (`htmlAudit.ts`)—not a linter replacement. |
| **Help** | **?** button in the header opens a kid-friendly guide covering all features: mic, editor, save, browser, sidebar, model selector, thinking, read aloud, Code Runner. |

---

## Troubleshooting

| Symptom | What to try |
|---|---|
| Startup: “Gemma is sleeping!” | Start Ollama; **Check again**. |
| “Gemma needs a download!” | `ollama pull gemma4:26b` (and `gemma4:e4b` for mic). |
| Mic disabled / grey | `ollama pull gemma4:e4b` — wait until pull finishes; app rescans tags. |
| First voice attempt slow / VRAM churn | Expected: **e4b** unloads (`keep_alive: 0`) before **26b** loads; wait ~10–30 s and retry. |
| Slow text on CPU | Switch to `gemma4:e2b` or `gemma4:e4b` — lighter models are much faster on CPU. `gemma4:26b` on CPU may take **tens of seconds** per turn. |
| Out of memory / crash during generation | Switch to a lighter model (`gemma4:e2b` recommended for older machines), close other apps, and try again. |
| **Read** missing or errors | Piper binary/voices absent or path wrong — see **Optional — Piper** above. |
| App can’t reach Ollama | Only **`127.0.0.1:11434`** is allowed from the renderer (CSP). No VPN/proxy blocking **localhost**. |

---

Open-source credits and thank-yous live in **[README → Acknowledgements](README.md#acknowledgements)**.

---

*Built for the Google Gemma 4 Good Hackathon · Kaggle 2026*
