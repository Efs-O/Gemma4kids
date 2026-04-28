# Gemma4kids — Setup Guide

Fully **offline-first**: after Ollama and models are installed, the app talks only to **`http://localhost:11434`** (and optional **local Piper** for read-aloud). No cloud subscriptions.

---

## Requirements

| | |
|---|---|
| **OS** | Windows 10/11 · macOS 12+ · Ubuntu 20.04+ |
| **RAM / VRAM** | **~8 GB RAM** usable for **`gemma4:e4b` only** experiments. **≥16 GB** system RAM—and ideally a **GPU**—for **`gemma4:26b` MoE** + **`gemma4:e4b`** STT comfortably. |
| **Disk** | ~30 GB free typical (both models + app build). |
| **Network** | For **setup pulls** only (`ollama pull`). Not required during normal kid use once models exist. |

---

## Step 1 — Install Ollama

Install from **[ollama.com/download](https://ollama.com/download)**.

```bash
ollama list   # confirms the daemon responds
```

---

## Step 2 — Pull Gemma 4 variants

Minimum for **full UX** (“big” coding model **and** microphone STT):

```bash
ollama pull gemma4:26b   # workstation MoE — primary option for richest HTML/tools
ollama pull gemma4:e4b   # edge — required for mic transcription; optional as coding model
```

- If **`gemma4:e4b` is missing** → **mic stays disabled**; typing still works.
- If **`gemma4:26b` is missing** but **`e4b` exists** → app can still run chat/tools on **`e4b`** (lighter limits).
- Header **Coding model** pick order is automatic at first launch: **prefers `gemma4:e4b` when detected** for faster iteration; switch to **`gemma4:26b…`** manually for heavier generation. **Voice STT always uses whichever `gemma4:e4b*` tag Ollama reports.**

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
| **Code Runner** | Mini-game appears only when the **selected coding model** is a **`gemma4:26b*`** tag **and** a reply is streaming. |
| **HTML repair** | Small automatic fixes apply on tool saves / post-stream (`htmlAudit.ts`)—not a linter replacement. |

---

## Troubleshooting

| Symptom | What to try |
|---|---|
| Startup: “Gemma is sleeping!” | Start Ollama; **Check again**. |
| “Gemma needs a download!” | `ollama pull gemma4:26b` (and `gemma4:e4b` for mic). |
| Mic disabled / grey | `ollama pull gemma4:e4b` — wait until pull finishes; app rescans tags. |
| First voice attempt slow / VRAM churn | Expected: **e4b** unloads (`keep_alive: 0`) before **26b** loads; wait ~10–30 s and retry. |
| Slow text on CPU | **`gemma4:26b`** on CPU may take **tens of seconds** per turn—normal. |
| **Read** missing or errors | Piper binary/voices absent or path wrong — see **Optional — Piper** above. |
| App can’t reach Ollama | Only **`127.0.0.1:11434`** is allowed from the renderer (CSP). No VPN/proxy blocking **localhost**. |

---

Open-source credits and thank-yous live in **[README → Acknowledgements](README.md#acknowledgements)**.

---

*Built for the Google Gemma 4 Good Hackathon · Kaggle 2026*
