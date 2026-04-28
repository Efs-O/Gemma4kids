# Gemma4kids

**Offline AI coding teacher for kids aged 6–11, powered by Google Gemma 4.**

No Internet. No subscription. No telemetry. Just a kid, local models, and a coding buddy.

---

## What it does

A child **types or speaks** a prompt (“make fireworks explode”). **Gemma 4** streams a reply, can **call tools** (save/read/list animations, open in the browser), and full **HTML** lands in the **CodeMirror** editor so they see and edit code. Kids **save**, **reload projects** from the sidebar, **delete** unwanted files, and **open animations in the default browser** (never inside Electron—untrusted HTML stays in the system browser).

Optional **“Read”** uses **local Piper speech** when configured (binary + voice ONNX under the app)—no cloud.

Built for the **Google Gemma 4 Good Hackathon** (Kaggle, May 2026)—e.g. **Future of Education** and **Ollama** special tracks.

---

## Feature snapshot

| Area | Behavior |
|---|---|
| **Models** | Header **Coding model** lists pulled **Gemma 4 edge** (`gemma4:e4b`…) and/or **26B MoE** (`gemma4:26b`…); default prefers **e4b** when installed (lighter cycle), otherwise **26B** for heavier generation. Pick what fits RAM and quality. |
| **Voice→text** | **Mic**: WAV → **`gemma4:e4b`** transcription via Ollama (`keep_alive: 0`). Disabled if **e4b** is not pulled. |
| **Chat** | Markdown answers; optional **Thoughts** (**Think On/Off** + **Show Thoughts**) reflect native thinking from the coding model where supported; **starter prompts** + **quick chips** after replies. Cancel / retry during errors. |
| **Tools** | Native tool calls **`save_animation`**, **`read_animation`**, **`list_animations`**, **`open_in_browser`**; HTML is audited/fixed lightly before persistence. |
| **Editor & projects** | Resizable sidebar (**saved animations**) + **chat** widths; **`Documents/KidAnimations/`** `.html` files with collision **`-2`**, **`-3`**, … if names clash. |
| **Code Runner** | Sidebar mini-game while **Gemma streams** **only when the selected coding model is `gemma4:26b`…** |
| **TTS (“Read”)** | **Piper** in **main**: optional local read-aloud on assistant bubbles if **`piper`** binary + **`voices`** are present—see **[SETUP.md](SETUP.md)**. |

---

## Quick start

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and keep it running. Pull what you plan to use:

```bash
ollama pull gemma4:e4b   # edge: STT + can drive full chat/tools (smaller footprint)
ollama pull gemma4:26b   # workstation MoE: strongest HTML + tools (much larger load)
```

> **RAM:** 8 GB allows edge-only experimentation; **16 GB+** is realistic for a smooth **26B** + **e4b** setup. GPUs help a lot.

### 2. Install Gemma4kids

Installer builds from Releases:

| Platform | Artifact |
|---|---|
| Windows | `Gemma4kids-Setup.exe` |
| macOS | `Gemma4kids.dmg` |
| Linux | `Gemma4kids.AppImage` |

**Releases:** [github.com/Efs-O/Gemma4kids/releases](https://github.com/Efs-O/Gemma4kids/releases)

> Unsigned hackathon builds: Windows **More info → Run anyway**; macOS **right‑click → Open** the first time.

### 3. Launch and create

1. Open Gemma4kids (Ollama must be up).
2. Choose **Coding model**, **Think** / **Show Thoughts** as you like.
3. Use the mic (if **e4b** is pulled) or type—then **Save** and **Open in Browser**.
4. **Read** aloud only appears when Piper voices are wired—see **[SETUP.md](SETUP.md)**.

Developer clone and scripts: **[SETUP.md](SETUP.md)** · **Architecture** below.

---

## Architecture

```
Electron shell
├── Main process
│   ├── IPC: animations (save / read / list / delete / open in OS browser)
│   └── Optional Piper TTS: piper/{piper.exe} + voices/*.onnx (+ .json)
└── Renderer (React + TypeScript + CodeMirror)
    ├── ChatPanel — Ollama native chat + streaming + tools + retries
    ├── VoiceInput — MediaRecorder WAV → gemma4:e4b transcription
    ├── EditorPanel — edits HTML streamed from the model / tools
    ├── ProjectList — load + delete KidAnimations *.html
    ├── CodeRunner — mini-runner while streaming (gemma4:26b coding model only)
    ├── htmlAudit.ts — lightweight repair before accepting saved HTML
    └── Ollama only at http://127.0.0.1:11434 — CSP enforced in index.html
```

**Typical pipelines**

- Speech: Mic → WAV → **e4b** → text prompt → coding model (**e4b** or **26b** selected in header).
- Coding: **`streamOllamaNativeChat`** Jinja templating + `tools[]` + thinking payload as configured.

---

## Why Gemma 4

- **gemma4:e4b** — multimodal audio in; good for STT **and**, when selected as coding model, the full offline agent loop without a second heavyweight model.
- **gemma4:26b** — strong HTML + MoE tooling for kids’ animations; unload **e4b** with `keep_alive: 0` after STT so VRAM frees for large weights.
- **Ollama** — local OpenAI-compat + native **`/api/chat`** for tool calling aligned with competition requirements.

---

## Development

```bash
git clone https://github.com/Efs-O/Gemma4kids.git
cd Gemma4kids
npm install
npm run dev          # esbuild + Electron
npm run typecheck    # strict TypeScript
npm run build        # bundle main/preload/renderer
npm run dist:win     # example: Windows installer
```

**Stack:** Electron · React 18 · TypeScript · CodeMirror 6 · esbuild · Ollama (localhost only).

---

## Competition reference

Verbatim **[Kaggle foundational rules](docs/competition/kaggle-foundational-rules.txt)** and **[Gemma 4 Good overview](docs/competition/gemma4-good-hackathon-overview.txt)** (requirements, tracks, deadlines) live under [`docs/competition/`](docs/competition/).

---

## Acknowledgements

Thank you to the teams behind the tools Gemma4kids depends on:

- **[Google Gemma](https://ai.google.dev/gemma)** — Gemma 4 model family (edge and workstation weights) run locally via Ollama.
- **[Ollama](https://ollama.com)** — local inference, OpenAI-compatible chat, and painless model pulls.
- **[Piper](https://github.com/rhasspy/piper)** (Rhasspy) — optional neural text-to-speech in the Electron main process when `piper` and voice ONNX bundles are installed.
- **Open-source stack shipped in this app**: [Electron](https://www.electronjs.org/) (bundles Chromium for the desktop shell), [React](https://react.dev/), [CodeMirror](https://codemirror.net/) (`@codemirror/lang-html`, `@codemirror/theme-one-dark`), [esbuild](https://esbuild.github.io/), [TypeScript](https://www.typescriptlang.org/), [react-markdown](https://github.com/remarkjs/react-markdown) with [remark-gfm](https://github.com/remarkjs/remark-gfm), [electron-builder](https://www.electron.build/). Exact versions are in **`package-lock.json`**.

These projects make an offline-first teaching tool practical; residual bugs and UX are ours alone.

---

## License

MIT — see [LICENSE](LICENSE).
