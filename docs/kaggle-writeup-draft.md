# Gemma4kids: Offline AI Learning Companion for Children, Powered by Gemma 4

**Subtitle:** An offline-first, multimodal AI buddy that helps children aged 6–11 learn anything — and build anything — through conversation, voice, and vision. No internet required, ever.

**Track:** Future of Education · Ollama Special Technology · llama.cpp Special Technology

---

## The Problem

Millions of children have no access to a teacher — of any kind. In classrooms with spotty internet, on tablets without a data plan, in homes where a subscription is not affordable — the barrier is not curiosity, it is infrastructure. Existing AI tutors require a cloud connection, a paid account, and adult supervision to get started.

We asked: what if a child could open an app, speak a sentence in their own language, and get help — right now, with WiFi off?

---

## What Gemma4kids Does

Gemma4kids is a **general learning companion** for children aged 6–11 — not only a coding teacher. A child can ask anything: "what do I do in an earthquake?", "explain fractions", "tell me a joke in Greek", "who was Leonardo da Vinci?". Gemma answers in warm, age-appropriate language in the child's own tongue. No cloud, no login, no adult required to get started.

When a child wants to **make something**, Gemma shifts into coding mode. A prompt — "make a butterfly dance" — produces a complete HTML animation streamed live into a code editor. The child sees the code, edits it, saves it, and opens it in the browser. Coding becomes a natural extension of curiosity, not a separate subject.

The app supports four Gemma 4 model sizes (E2B, E4B, 26B, 31B) and two local runtimes (Ollama and llama.cpp), covering hardware from an 8 GB laptop to a 24 GB GPU workstation. It speaks Greek, German, and English, with voice input, video attachment, and local TTS — all on-device.

---

## Architecture

Gemma4kids runs on Electron, React 18, TypeScript (strict throughout), CodeMirror 6, and esbuild. All inference is localhost-only; the Content Security Policy in `index.html` enforces this at the browser level.

**Dual runtime.** The startup screen offers Ollama (native `/api/chat`) or llama.cpp (Gemma4kids spawns and manages `llama-server` directly — one instance for the coding model, a second for STT on port 8081).

**Model tier system.** `pickCodingModel.ts` auto-selects the lightest available model at startup (E2B → E4B → 26B → 31B). A `ModelTier` (`simple` | `full`) gates prompts and routing: edge models get a simplified prompt and intent classifier; workstation models get the full CREATE/EDIT suite with 122 k token context (vs 65 k for edge).

**Intent routing.** Every turn is classified as `art` (full agentic HTML loop), `motion` (simpler CSS animation), or `chat` (plain answer, no tools). On simple-tier models, a `__TOOBIG__` signal escalates complex requests to the larger model automatically.

**Agentic tool loop.** Five native tool calls: `save_animation`, `read_animation`, `list_animations`, `open_in_browser`, `save_video_frame`. All execution is in the Electron main process via contextBridge IPC.

**Multimodal pipeline.** Images are base64-encoded and sent directly. Videos (≤ 30 s) are preprocessed by ffmpeg: 3–6 frames at up to 640 px plus an optional audio WAV — all sent as a multimodal payload.

**Voice I/O for text-only models.** 26B and 31B have no native audio support. E4B/E2B acts as an STT bridge — WAV → transcription → text → coding model — giving them voice input. Piper neural TTS gives them voice output. `keep_alive: 0` on every STT call forces immediate VRAM unload so the large model loads cleanly. Both workstation models become fully voice-capable through architecture alone.

**Output reliability.** We benchmarked 12 generations (3 prompts × 4 variants, think on/off) and found three failure classes: `window-innerHeight` with a minus instead of a dot (NaN canvas), CSS vars as animation durations (frozen animation), and nth-child offset by sibling elements. Both `think: off` variants produced blank screens. We added targeted prompt constraints; all three prompts passed with `think: true`. A secondary `htmlAudit.ts` layer (Acorn JS parser + deterministic repairs) runs in under 1 ms as a safety net.

---

## Gemma 4 Features Used

- **Native function calling** — save/load/preview driven by `tools[]`, not string parsing.
- **Thinking mode** — `think: true` mandatory for reliable output; `think: false` for STT and intent classification.
- **Multimodal audio (E4B/E2B as STT bridge)** — WAV sent as multimodal payload; transcribed text forwarded to the coding model, giving 26B/31B effective voice input they do not natively have.
- **Piper TTS as voice output bridge** — 26B/31B gain voice output via local neural TTS; together with STT, both become fully voice-capable.
- **Multimodal vision** — images and video frames as base64 in `images[]`.
- **Edge models** — full agent loop on 6–8 GB hardware; E2B preferred for Greek STT.
- **Ollama native protocol** — `ollamaNativeChat.ts` accesses thinking payloads unavailable in the OpenAI-compat layer.
- **llama.cpp GGUF** — K/V cache quantization (f16 through iq4_nl); automatic mmproj discovery for multimodal.

---

## Challenges and How We Solved Them

**VRAM contention.** STT and coding models cannot run simultaneously without exhausting GPU memory. `keep_alive: 0` unloads the STT model immediately after each transcription. Under llama.cpp, the dedicated STT server is scheduled independently on a separate port.

**Blank-screen animations.** `think: off` produced blank screens in benchmarks. Fixed by combining three targeted prompt constraints with the `htmlAudit.ts` repair pass.

**Greek ASR.** E4B gave unstable Greek transcriptions. `pickGreekTranscribeModel()` routes Greek audio to E2B, which is more stable, while keeping E4B for English and German.

**Context exhaustion.** A color-coded context meter (green → orange → red) shows remaining capacity. One click clears the session. Conversation truncation (system prompt + last 10 pairs + last 4 tool results) keeps requests within budget.

---

## Why These Technical Choices

Fully offline operation was non-negotiable for classrooms without reliable internet. Electron gives a native installation on Windows, macOS, and Linux. The dual runtime means the app runs on machines that cannot host an Ollama daemon. Strict TypeScript prevents runtime bugs before a child ever sees the app.

---

## Impact

A child in a Greek village asks "what do I do in an earthquake?" and gets a calm, age-appropriate answer in Greek — offline, instantly, for free. The same child says "make a shaking building animation" and watches the code appear. A child in a German classroom attaches a photo of their drawing and asks Gemma to make it move. A child anywhere with an 8 GB laptop and no internet has the same AI companion as a child with a cloud subscription.

Gemma4kids is not a toy. It is infrastructure — a learning companion that runs on the hardware schools already have, in the languages children already speak, with the WiFi switched off.

---

Gemma is not just another AI for chat and entertainment. She is a friend, a guide, a teacher — standing quietly but steadily beside every child.

Through every question and every answer, she does not merely transmit information. She opens paths of thought. She encourages children to discover, to question, to understand the world around them. She helps them build confidence, find their own voice, and work out their own solutions to the everyday problems life puts in front of them.

In an age when screens too often limit imagination, Gemma is built to set it free — to make thinking move, creativity blossom, and learning become an experience rather than a lesson.

And through that journey, she brings children into contact with coding — not as something difficult or distant, but as a creative tool for expressing ideas and understanding how the world works.

She does not just teach children what to think. She teaches them how to think.

---

## Known Limitations

We would rather be precise than overclaim:

- **Read-aloud (local Piper TTS) does not work on macOS in this build.** The Piper voice engine cannot load on a clean Mac (it links a system audio library Apple does not ship), and the macOS fallback path is still being fixed. Read-aloud works as designed on **Windows and Linux**. Voice *input*, chat, code generation, editing, saving, and browser preview all work on macOS — only spoken output of replies is affected.
- **Unsigned macOS build triggers repeated microphone permission prompts.** This is a macOS TCC behavior for unsigned apps, not an app defect; voice input works once permission is granted. Removing the repeated prompt requires a code-signed build (paid Apple Developer account), which is out of scope for this submission.

These are platform-packaging limitations, not architectural ones: the same TTS pipeline runs correctly on Windows and Linux, and macOS troubleshooting is ongoing after submission.

## Links

- **Code repository:** https://github.com/Efs-O/Gemma4kids
- **Video:** [YouTube link — add when published]
- **Live demo / installer:** https://github.com/Efs-O/Gemma4kids/releases
