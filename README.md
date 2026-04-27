# Gemma4kids

**Offline AI coding teacher for kids aged 6–11, powered by Google Gemma 4.**

No internet. No subscription. No data sent anywhere. Just a kid, a mic, and a coding buddy.

---

## What it does

A child types or speaks a prompt ("make fireworks explode") and Gemma generates a full HTML animation live on their screen. They see the code, can edit it, save it, and open it in the browser — all without ever touching the cloud.

Built for the **Google Gemma 4 Good Hackathon** (Kaggle, May 2026) — Future of Education track.

---

## Quick start

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and start it. Then pull the two models:

```bash
ollama pull gemma4:e4b   # voice / speech-to-text  (9.6 GB)
ollama pull gemma4:26b   # code generation          (~17 GB)
```

> **Minimum specs:** 8 GB RAM (text-only, uses gemma4:e4b as fallback). 16 GB RAM recommended for the full voice + code experience.

### 2. Install Gemma4kids

Download the installer for your platform from the [Releases](../../releases) page:

| Platform | File |
|---|---|
| Windows | `Gemma4kids-Setup.exe` |
| macOS | `Gemma4kids.dmg` |
| Linux | `Gemma4kids.AppImage` |

> **Note:** This is an unsigned indie/hackathon build. On Windows click "More info → Run anyway"; on macOS right-click the app → Open → confirm.

### 3. Launch and create

1. Open Gemma4kids
2. Press the mic button and say *"Make a bouncing ball"*
3. Watch Gemma write the code live
4. Press **Save**, then **Open in Browser**

---

## Architecture

```
Electron shell
├── Main process (Node.js)
│   ├── IPC handlers: save / read / list / open animations
│   └── Files saved to Documents/KidAnimations/
└── Renderer process (React + TypeScript)
    ├── ChatPanel — streaming chat with Gemma 4
    ├── CodeEditor — CodeMirror 6, HTML+JS highlighting
    ├── VoiceInput — MediaRecorder → base64 WAV → gemma4:e4b STT
    ├── llm/ — OpenAIClient.ts (streaming), types.ts, cancellation.ts
    └── OllamaService — health check, model detection, transcription
```

**Voice pipeline:**
```
Mic → WAV → base64 → gemma4:e4b (keep_alive:0) → text → gemma4:26b → HTML code
```

**Agentic tool calling:** Gemma 4 calls `save_animation`, `read_animation`, `list_animations`, and `open_in_browser` tools natively. When a kid says "save it", Gemma saves the file — no button click needed.

---

## Why Gemma 4

- **gemma4:e4b** — native audio encoder accepts base64 WAV in the `images[]` field, enabling zero-dependency speech-to-text without a separate STT model
- **gemma4:26b** — strong code generation + native tool calling via Ollama's Jinja chat template
- **VRAM offload** — `keep_alive: 0` on E4B forces immediate GPU unload so 26b can load cleanly
- **Ollama server-side templating** — Jinja chat template applied automatically; we only pass the `tools[]` array

---

## Development

```bash
git clone https://github.com/Efs-O/Gemma4kids
cd Gemma4kids
npm install
npm run dev          # build + open Electron window
npm run typecheck    # TypeScript strict check
npm run dist:win     # build Windows installer
```

**Stack:** Electron · React · TypeScript · CodeMirror 6 · esbuild · Ollama

---

## License

MIT — see [LICENSE](LICENSE)
