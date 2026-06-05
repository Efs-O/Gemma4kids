# Gemma4kids

**Offline AI coding teacher for kids aged 6–11, powered by Google Gemma 4.**

No Internet. No subscription. No telemetry. Just a kid, local models, and a coding buddy.

---

## What it does

Gemma4kids is a **general learning companion for kids**, not only a coding teacher. A child can ask anything: "what do I do in an earthquake?", "tell me a joke in Greek", "explain fractions", "make up a story about a dragon" — Gemma answers in plain, age-appropriate language in the child's own language. When the child wants to **make something**, Gemma shifts into coding mode: a prompt ("make fireworks explode") produces a complete HTML animation that streams live into the **CodeMirror** editor so they see and edit the code. Kids **save**, **reload projects** from the sidebar, and **open animations in the default browser**.

A child can also **attach an image or short video** — Gemma sees it, answers questions about it, and can turn a drawing into a live animation. Optional **"Read"** uses **local Piper speech** when configured — no cloud (works on **Windows/Linux**; macOS read-aloud is a known issue under troubleshooting — see [INSTALL_MAC.md](INSTALL_MAC.md)).

She does not just teach children what to think. She teaches them how to think.

Built for the **Google Gemma 4 Good Hackathon** (Kaggle, May 2026) — targeting the **Future of Education**, **Ollama**, and **llama.cpp** special tracks.

---

## Feature snapshot

| Area | Behavior |
|---|---|
| **Runtime** | Choose **Ollama** (easy, guided) or **llama.cpp** (advanced, GGUF paths + GPU layers) at the startup screen. Gemma4kids auto-starts the local server for both. Switch runtimes any time without restarting. |
| **Models** | Header dropdown lists all pulled Gemma 4 variants, sorted smallest→largest. **Auto-selects the lightest available** at startup (E2B → E4B → 26B → 31B) so the app is immediately usable; upgrade via the dropdown any time. **E2B and E4B** use simplified prompts and an intent classifier (simple tier). **26B and 31B** use the full CREATE/EDIT prompt suite (full tier). |
| **Context window** | Edge models (E2B/E4B): 65 k token context. Workstation models (26B/31B): 122 k token context. A **"New Chat" button** sits in the input row next to Send — its background fill shows remaining capacity (green → orange → red, pulsing when critical). Click it at any time to clear the conversation and start fresh. |
| **Voice→text** | Mic button → WAV → STT model via Ollama (`keep_alive: 0`) or a **dedicated llama.cpp STT server** (port 8081, separate from the coding model). The E4B-family transcribe path handles English, German, and Greek audio; Greek also uses stricter prompting and script-mismatch retry logic to keep transcripts in Greek script. Disabled when no STT model is configured. |
| **Vision & video** | Paperclip button attaches an **image** or a short **video clip** (≤ 30 s). Images go to the model directly. Videos are preprocessed by **ffmpeg**: 3–6 frames sampled at up to 640 px, plus an optional audio WAV extract — all sent as a multimodal payload. Gemma can describe the content, answer questions, or turn a drawing into a live animation. |
| **Video frame tool** | When a video is attached, Gemma can call **`save_video_frame`** to capture JPEG stills at specified timestamps and save them to `Documents/KidAnimations/video-frames/`. |
| **Smart routing** | An intent classifier runs on every turn and decides: **art** (full agentic HTML loop with tools), **motion** (simpler animation via SIMPLE prompt), or **chat** (plain conversation, no tools). On simple-tier models, a `__TOOBIG__` signal escalates complex requests to the big model automatically. |
| **Edit detection** | When a project is loaded from the sidebar, Gemma automatically knows which file is active. Edit-intent keywords ("fix", "change", "improve", "bigger", "color"…) switch the system prompt to **EDIT mode**, which preserves existing code and only applies the requested change — no full rewrites. |
| **General learning** | Gemma answers any question a child asks — stories, jokes, riddles, quizzes, science, maths, safety ("what do I do in an earthquake?"), history, or anything else — in plain, age-appropriate language, in the child's own tongue. The intent classifier routes these to a dedicated conversational mode with no code tools exposed, so responses are fast and child-friendly. Coding is one capability among many, not the only one. |
| **Chat** | Markdown answers. Optional **Thoughts** (**Think On/Off** + **Show Thoughts**) expose the model's reasoning chain. **12 starter prompt cards** (3 shown at random, reshuffled after each reply) — edge models get a separate kid-friendly card pool. **12 suggestion chips** after each reply (3 shown at random), always including a "Make something new" escape. |
| **Tools** | Native tool calls: **`save_animation`**, **`read_animation`**, **`list_animations`**, **`open_in_browser`**, **`save_video_frame`**. HTML is audited/fixed before persistence. |
| **Editor & projects** | Resizable sidebar (**saved animations**) + chat widths. Files save to **`Documents/KidAnimations/`** with `-2`, `-3`… suffixes on name collisions. An **unsaved-changes dot** turns red when the editor has been modified and green on successful save. A **"Gemma's version"** button reverts manual edits back to the last AI-generated code. |
| **Code Runner** | Side-scroller mini-game plays while Gemma streams (26B/31B only). Press **Space** to jump and dodge bugs. High score persists in localStorage. |
| **TTS ("Read")** | **Piper** in main process: read-aloud speaker button on every assistant message when `piper` binary + voice ONNX bundles are installed. Detects language (EN/DE/EL) and routes to the matching voice — no cloud. **Windows/Linux only in this build**; macOS read-aloud is a known issue under active troubleshooting (see **[INSTALL_MAC.md](INSTALL_MAC.md)**). See **[SETUP.md](SETUP.md)**. |
| **Multilingual** | A **language picker** (🇬🇧 EN / 🇩🇪 DE / 🇬🇷 EL) on the welcome screen sets the session language before anything loads. All system prompts instruct Gemma to reply in the chosen language. Motion keywords in Greek (κινούμενο, κίνηση, πέφτει…) and German (animiert, bewegt, fallen…) are recognised by the intent router. The STT pipeline uses the selected language directly — no browser-locale guessing. |

---

## Quick start

### 1. Choose your runtime

**Option A — Ollama (recommended)**

Download from [ollama.com](https://ollama.com) and keep it running. Pull what fits your hardware:

```bash
ollama pull gemma4:e2b   # lightest — older GPUs, ~3 GB VRAM (default at startup)
ollama pull gemma4:e4b   # edge — STT + full chat/tools, ~6 GB VRAM
ollama pull gemma4:12b   # full tier — dense 12B, 64 k context, ~8 GB VRAM (4-bit)
ollama pull gemma4:26b   # workstation — excellent quality, ~17 GB VRAM
ollama pull gemma4:31b   # workstation — highest quality, 64 k context, ~20 GB VRAM
```

> `gemma4:12b` may not be in the Ollama registry yet. If `ollama pull` can't find it, register a local GGUF instead:
> `ollama create gemma4:12b -f Modelfile` where `Modelfile` contains `FROM <path-to>\gemma-4-12b-it-UD-Q4_K_XL.gguf`.

> The app auto-selects the **lightest model you have pulled**. You can switch to a larger one in the header dropdown at any time.
>
> **RAM guide:** 8 GB → E2B/E4B only · 20 GB+ VRAM → 26B smooth · 24 GB+ VRAM → 31B

**Option B — llama.cpp (advanced)**

Download a [llama.cpp release](https://github.com/ggml-org/llama.cpp/releases) and point Gemma4kids at your GGUF model files via the setup screen. Gemma4kids spawns and manages `llama-server` automatically — one instance for the coding model, a separate one for STT. No Ollama installation needed. **You can paste a folder path** — if the folder contains exactly one non-mmproj `.gguf`, the app selects it automatically. Vision and video features require an `mmproj` companion file alongside your GGUF; Gemma4kids searches for it automatically (including one level up from the model folder). Advanced options include GPU layer count, context size, max tokens, and K/V cache quantization (f16, bf16, q8_0, q5_1, q5_0, q4_1, q4_0, iq4_nl).

**Video features (both runtimes):** frame extraction and audio capture require **ffmpeg** on your PATH.

### 2. Install Gemma4kids

Installer builds from Releases:

| Platform | Artifact |
|---|---|
| Windows | `Gemma4kids-Setup.exe` |
| macOS | `Gemma4kids.dmg` |
| Linux | `Gemma4kids.AppImage` |

**Releases:** [github.com/Efs-O/Gemma4kids/releases](https://github.com/Efs-O/Gemma4kids/releases)

> Unsigned hackathon builds: Windows **More info → Run anyway**; macOS **right‑click → Open** the first time.
>
> **macOS note:** read-aloud ("Read") is **not working on macOS** in this build and is under active troubleshooting; the mic prompts repeatedly because the build is unsigned. Everything else works. Full details and the macOS open steps are in [INSTALL_MAC.md](INSTALL_MAC.md).

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

1. Open Gemma4kids. A **welcome screen** asks you to pick your language (🇬🇧 EN / 🇩🇪 DE / 🇬🇷 EL), then the startup screen asks you to pick **Ollama** or **llama.cpp**. While the model loads, animated dots and a progress message let you know it's working (large models can take a minute or two).
2. Choose **Coding model**, **Think** / **Show Thoughts** as you like.
3. Type a prompt or press the **mic** button to speak (STT model required). While voice is being transcribed the **Send** button shows **"Preparing…"** and locks until the text is ready.
4. Use the **paperclip** to attach an image or video before sending.
5. **Save** → **Open in Browser** to see the animation full-screen.
6. **Read** aloud only appears when Piper voices are installed — see **[SETUP.md](SETUP.md)**. **macOS:** read-aloud is a known issue in this build (not working yet) — see **[INSTALL_MAC.md](INSTALL_MAC.md)**.

Developer clone and scripts: **[SETUP.md](SETUP.md)** · **Architecture** below.

---

## Architecture

```
Electron shell
├── Main process
│   ├── animationStore.ts — IPC: save / read / list / delete / open in OS browser
│   ├── llamaRuntime.ts — spawns / manages llama-server (coding model)
│   ├── llamaSttRuntime.ts — separate llama-server instance for STT (port 8081)
│   ├── IPC: preprocess-video-attachment, inspect-video-attachment (ffmpeg)
│   └── Optional Piper TTS: piper/{piper.exe} + voices/*.onnx (+ .json)
└── Renderer (React + TypeScript + CodeMirror)
    ├── App.tsx — runtime selector, model selector, think toggles, resizable panes
    ├── SetupAssistant.tsx — startup: Ollama vs llama.cpp runtime cards
    ├── ChatPanel — streaming chat, starter cards, suggestion chips, context meter
    ├── chatRouting.ts — intent classifier: art / motion / chat → right system prompt
    │   └── 5 system prompts: CREATE · EDIT · SIMPLE · KID_CHAT · INTENT_CLASSIFIER
    ├── chatTools.ts — tool dispatch, HTML audit integration
    ├── VoiceInput — MediaRecorder WAV → STT (Ollama or llama.cpp); language-aware prompts with Greek-script retry guard
    ├── MediaAttachmentService — frame extraction + audio WAV from video (ffmpeg)
    ├── AttachmentPreview — thumbnail strip for image / video before send
    ├── InputRow — textarea + mic button + paperclip attach
    ├── EditorPanel — CodeMirror 6, audit badge, unsaved-changes dot, "Gemma's version" revert
    ├── ProjectList — sidebar: load / delete KidAnimations/*.html; injects active file context
    ├── CodeRunner — side-scroller game during streaming (26B/31B only); Space to jump
    ├── htmlAudit.ts — Acorn-based JS/HTML repair; badge shows fix count
    └── pickCodingModel.ts — E2B→E4B→12B→26B→31B auto-select; getModelTier(); pickGreekTranscribeModel()
```

**Typical pipelines**

- Speech: Mic → WAV → STT model (E4B-family path with language-aware prompts and Greek-script retry guard) → text → coding model.
- Vision: Paperclip → image → base64 → multimodal payload → coding model.
- Video: Paperclip → ffmpeg → 3–6 frames + audio WAV → base64 → multimodal payload. Model may call `save_video_frame` to capture stills.
- Coding: Intent classifier → CREATE or EDIT system prompt → `streamOllamaNativeChat` / llama.cpp stream → tool loop → htmlAudit → editor.
- Chat: Intent classifier → KID_CHAT / SIMPLE prompt → plain text reply, no tools.

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

**Secondary fix — deterministic audit layer** (`htmlAudit.ts`). Every HTML file passes through a lightweight repair pass before it reaches the child — tag typo correction, `forwards → infinite`, kebab-case `.style` properties → camelCase, undefined CSS variables injected, `window-prop` dot fix, and an Acorn JS parse gate. This runs in under 1 ms with no network calls. When the audit applies a fix, the editor shows a small **"✓ code checked · N fixes applied"** badge.

The audit is a safety net, not a crutch. The improved prompt handles the common cases; the audit catches anything that slips through on unusual prompts or edge runs.

All benchmark scripts and results live under [`scripts/`](scripts/) and [`gemma_code_quality_report.md`](gemma_code_quality_report.md).

---

## Why Gemma 4

- **gemma4:e2b** — lightest model in the family; runs on older or low-VRAM GPUs; default at startup.
- **gemma4:e4b** — natively multimodal (audio-in); serves as the STT engine for English, German, and Greek, with stricter Greek prompting and retry logic to keep transcripts in Greek script. It can also run the full agent loop on its own on smaller GPUs.
- **gemma4:12b** — dense 12B, full tier, 64 k context, ~8 GB VRAM at 4-bit (Q4_K_XL). A mid-weight step between the edge models and the 26B/31B workstation tier. Same voice pipeline as the larger models — E4B handles STT, Piper handles TTS.
- **gemma4:26b** — text-only workstation model, 98 k context. **Gains full voice I/O** through the pipeline: E4B/E2B transcribes speech → text → 26B, and Piper TTS speaks 26B's replies back to the child. `keep_alive: 0` on the STT call forces immediate VRAM unload so 26B can load cleanly.
- **gemma4:31b** — text-only, highest quality, 64 k context. Same voice pipeline as 26B — STT handles input, Piper handles output — giving it capabilities it does not natively possess.
- **Ollama** — local native `/api/chat` for tool calling and thinking; painless model pulls; aligned with competition requirements.
- **llama.cpp** — GGUF inference with no daemon required. Gemma4kids spawns its own `llama-server` processes — one for the coding model, one for STT — giving full offline operation on hardware where Ollama is unavailable or undesirable.

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

**Stack:** Electron · React 18 · TypeScript · CodeMirror 6 · esbuild · Ollama or llama.cpp (localhost only) · ffmpeg (optional, for video features).

---

## Greek TTS — JOY voice

Greek read-aloud is powered by **JOY** (`el_GR-joy-medium`), the first open-source Greek Piper TTS voice trained entirely on native human speech.

Full voice documentation: [`voices/el_GR-joy-medium.VOICE_CARD.md`](voices/el_GR-joy-medium.VOICE_CARD.md) · License: [`voices/el_GR-joy-medium.LICENSE.txt`](voices/el_GR-joy-medium.LICENSE.txt)

### Why it matters

All previous community Greek TTS voices were trained on synthetic or low-quality data, producing robotic, mispronounced output unsuitable for children or educational use. JOY fills that gap.

### What it is

| Field | Value |
|---|---|
| **Voice name** | JOY (Χαρά — "Joy" in Greek) |
| **Language** | Greek · el_GR |
| **Architecture** | Piper VITS — same engine as EN and DE voices |
| **Sample rate** | 22 050 Hz, 16-bit mono |
| **Speaker** | Chara Kaltsou — native Greek speaker, BA Aristotle University of Thessaloniki (AUTH), MA Hellenic Open University (HOU) |
| **Dataset** | ~3 000 human utterances recorded in a controlled environment — zero synthetic data |
| **Domain** | Children's vocabulary, storytelling, school language, numbers, Greek cultural references |
| **Training** | piper-train official toolkit · VITS · 20 epochs · batch 32 |
| **Source project** | [Gemma4GR](https://github.com/Efs-O/Gemma4GR) |
| **License** | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) |

### Measured reliability

In the Gemma4GR evaluation suite (100 Greek answer WAVs synthesised across 4 model variants), **JOY produced 100/100 WAVs without a single synthesis failure**. No audio quality issues were observed across any run.

### Community impact

JOY was created as part of the [Gemma4GR](https://github.com/Efs-O/Gemma4GR) sister project and is contributed to the open-source community. The voice serves two roles:

1. **Runtime TTS in Gemma4kids** — Gemma writes a Greek reply → JOY speaks it to the child, offline, no cloud.
2. **STT training fuel in Gemma4GR** — JOY synthesised 2 488 Greek Q&A audio pairs used to train Gemma's audio LoRA for listen-and-answer capability in Greek.

### Attribution (required by CC BY-NC 4.0)

```
JOY Greek voice (el_GR-joy-medium)
Gemma4GR project — https://github.com/Efs-O/Gemma4GR
Speaker: Chara Kaltsou, BA AUTH, MA HOU
License: CC BY-NC 4.0 — https://creativecommons.org/licenses/by-nc/4.0/
```

---

## Competition reference

Verbatim **[Kaggle foundational rules](docs/competition/kaggle-foundational-rules.txt)** and **[Gemma 4 Good overview](docs/competition/gemma4-good-hackathon-overview.txt)** (requirements, tracks, deadlines) live under [`docs/competition/`](docs/competition/).

---

## Acknowledgements

Thank you to the teams behind the tools Gemma4kids depends on:

- **[Google Gemma](https://ai.google.dev/gemma)** — Gemma 4 model family (E2B, E4B, 26B, 31B) run locally via Ollama or llama.cpp.
- **[Ollama](https://ollama.com)** — local inference, native `/api/chat` for tool calling and thinking, painless model pulls.
- **[llama.cpp](https://github.com/ggml-org/llama.cpp)** (ggml-org) — GGUF inference engine powering the alternative runtime; Gemma4kids manages `llama-server` directly for both coding and STT workloads.
- **[ffmpeg](https://ffmpeg.org/)** — video frame extraction and audio capture for the multimodal attachment pipeline.
- **[Piper](https://github.com/rhasspy/piper)** (Rhasspy) — optional neural TTS in the Electron main process.
- **JOY Greek voice** (`el_GR-joy-medium`) — first high-quality open-source Greek Piper TTS voice, trained on ~3 000 human recordings by native speaker Chara Kaltsou (BA AUTH, MA HOU). Created for the [Gemma4GR](https://github.com/Efs-O/Gemma4GR) project. License: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
- **[Acorn](https://github.com/acornjs/acorn)** — small JavaScript parser used in `htmlAudit.ts` to catch broken inline JS in model output before save.
- **Open-source stack shipped in this app**: [Electron](https://www.electronjs.org/), [React](https://react.dev/), [CodeMirror](https://codemirror.net/) (`@codemirror/lang-html`, `@codemirror/theme-one-dark`), [esbuild](https://esbuild.github.io/), [TypeScript](https://www.typescriptlang.org/), [react-markdown](https://github.com/remarkjs/react-markdown) with [remark-gfm](https://github.com/remarkjs/remark-gfm), [electron-builder](https://www.electron.build/). Exact versions in `package-lock.json`.

These projects make an offline-first teaching tool practical; residual bugs and UX are ours alone.

---

## License

MIT — see [LICENSE](LICENSE).
