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
| **Models** | Header **Coding model** lists pulled Gemma 4 variants; auto-selects best available: **31B** (`gemma4:31b`) → **26B** (`gemma4:26b`) → **edge** (`gemma4:e4b`) → **e2b**. Pick what fits your VRAM. |
| **Voice→text** | **Mic**: WAV → **`gemma4:e4b`** transcription via Ollama (`keep_alive: 0`). Disabled if **e4b** is not pulled. |
| **Chat** | Markdown answers; optional **Thoughts** (**Think On/Off** + **Show Thoughts**) reflect native thinking from the coding model where supported; **starter prompts** + **quick chips** after replies. Cancel / retry during errors. |
| **Tools** | Native tool calls **`save_animation`**, **`read_animation`**, **`list_animations`**, **`open_in_browser`**; HTML is audited/fixed lightly before persistence. |
| **Editor & projects** | Resizable sidebar (**saved animations**) + **chat** widths; **`Documents/KidAnimations/`** `.html` files with collision **`-2`**, **`-3`**, … if names clash. Kids can paste or type their own HTML into the editor, save it, then ask Gemma to explain or improve it. Clicking a sidebar project loads it and automatically tells Gemma which file is active so it can review it on request. |
| **Code Runner** | Sidebar mini-game while **Gemma streams**, active when coding model is **`gemma4:26b`** or **`gemma4:31b`**. |
| **TTS (“Read”)** | **Piper** in **main**: optional local read-aloud on assistant bubbles if **`piper`** binary + **`voices`** are present—see **[SETUP.md](SETUP.md)**. |

---

## Quick start

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and keep it running. Pull what you plan to use:

```bash
ollama pull gemma4:31b   # highest quality — 64 k context, ~20 GB (24 GB VRAM)
ollama pull gemma4:26b   # excellent quality — ~17 GB (20 GB VRAM)
ollama pull gemma4:e4b   # edge: STT + full chat/tools on smaller GPUs (~6 GB)
```

> **RAM:** 8 GB allows edge-only use; **20 GB+ VRAM** runs 26b smoothly; **24 GB+ VRAM** for 31b. GPUs help a lot.

### 2. Install Gemma4kids

Installer builds from Releases:

| Platform | Artifact |
|---|---|
| Windows | `Gemma4kids-Setup.exe` |
| macOS | `Gemma4kids.dmg` |
| Linux | `Gemma4kids.AppImage` |

**Releases:** [github.com/Efs-O/Gemma4kids/releases](https://github.com/Efs-O/Gemma4kids/releases)

> Unsigned hackathon builds: Windows **More info → Run anyway**; macOS **right‑click → Open** the first time.

Installer/runtime guarantees:

- Windows packages are built with NSIS. They support normal install/uninstall behavior and install into a chosen folder, but this repo does not claim a separate repair mode.
- macOS packages ship as DMG + ZIP. Install is drag-to-Applications; uninstall is removing the app bundle. No dedicated installer repair flow is provided.
- Linux ships as an AppImage. It is portable rather than a system installer, so uninstall is deleting the AppImage and any user data you no longer want.
- Runtime is single-instance: launching Gemma4kids again focuses the existing window instead of opening a second app process.

GitHub Actions notes:

- `.github/workflows/ci.yml` runs `npm run build` and `npm run typecheck` on Windows, macOS, and Linux for pushes and pull requests.
- `.github/workflows/build-testers.yml` is a manual packaging workflow for tester artifacts.
- Packaging on GitHub requires bundled `piper/` and `voices/` assets to exist in the checkout or be fetched before packaging. The repo currently ignores those folders by default, so packaging will fail until that asset delivery path is solved.

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

## Output reliability — what we measured and what we did about it

A child who asks for fireworks and gets a blank screen quits the app. Before shipping, we ran a systematic benchmark: **12 generations** across **3 prompts × 4 model variants** (gemma4:e4b and gemma4:26b, thinking on/off), visually evaluated every output, and found three recurring failure classes in raw model output:

| Failure | Root cause | Effect |
|---|---|---|
| `window-innerHeight` | minus sign instead of dot | canvas size = NaN → blank screen |
| `animation: pulse var(--x) infinite` | CSS var as duration (no time unit) | animation declaration invalid → frozen |
| `.class:nth-child(1)` offset | other sibling elements precede the target | CSS selectors match nothing → transparent wings |

**What we found:** both `think: off` variants produced at least one blank screen. Both `think: on` variants were visually correct across all prompts. Conclusion: `think: true` is mandatory in production.

**Primary fix — prompt engineering.** We added three targeted constraints to the system prompt (dot notation for `window` properties, literal time values for animation duration, nth-child counting rules). We then reran all three failing prompts with `think: true` and **no post-processing applied**. All three outputs worked correctly in the browser.

**Secondary fix — deterministic audit layer** (`htmlAudit.ts`). Every HTML file passes through a lightweight repair pass before it reaches the child — tag typo correction, `forwards → infinite`, kebab-case `.style` properties → camelCase, undefined CSS variables injected, `window-prop` dot fix, and an Acorn JS parse gate. This runs in under 1 ms with no network calls. When the audit applies a fix, the editor shows a small **"✓ code checked · N fixes applied"** badge so we can observe it during development.

The audit is a safety net, not a crutch. The improved prompt handles the common cases; the audit catches anything that slips through on unusual prompts or edge runs.

All benchmark scripts and results live under [`scripts/`](scripts/) and [`gemma_code_quality_report.md`](gemma_code_quality_report.md).

---

## Why Gemma 4

- **gemma4:e4b** — multimodal audio in; good for STT **and**, when selected as coding model, the full offline agent loop without a second heavyweight model.
- **gemma4:26b** — strong HTML + MoE tooling for kids’ animations; unload **e4b** with `keep_alive: 0` after STT so VRAM frees for large weights.
- **gemma4:31b** — highest quality coding model in the family; runs at **64 k context** (vs 98 k for 26b) to fit within 24 GB VRAM without sacrificing meaningful context for kids’ animations.
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
- **[Acorn](https://github.com/acornjs/acorn)** — small JavaScript parser used in **`htmlAudit.ts`** to parse `<script>` bodies and catch broken inline JS in model output before save.
- **Open-source stack shipped in this app**: [Electron](https://www.electronjs.org/) (bundles Chromium for the desktop shell), [React](https://react.dev/), [CodeMirror](https://codemirror.net/) (`@codemirror/lang-html`, `@codemirror/theme-one-dark`), [esbuild](https://esbuild.github.io/), [TypeScript](https://www.typescriptlang.org/), [react-markdown](https://github.com/remarkjs/react-markdown) with [remark-gfm](https://github.com/remarkjs/remark-gfm), [electron-builder](https://www.electron.build/). Exact versions are in **`package-lock.json`**.

These projects make an offline-first teaching tool practical; residual bugs and UX are ours alone.

---

## License

MIT — see [LICENSE](LICENSE).
