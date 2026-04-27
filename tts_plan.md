# TTS Voice Plan — Gemma4kids

**Date:** 2026-04-27
**Feature:** Text-to-Speech output for Gemma's responses
**Primary engine:** Piper TTS (offline, child-process from Electron main, no CSP changes)
**Fallback:** Gemini 2.5 Flash TTS via Electron main process IPC (if Piper quality is unacceptable on demo hardware)

---

## Why a Speaker Button?

Yes — a speaker button on every Gemma message bubble is essential:

- Kids aged 8–12 may struggle to read longer explanations
- Lets a child replay a step they missed without retyping
- Natural affordance: they already expect "tap to hear" from every device they own
- Costs almost nothing to add alongside the TTS service

---

## Architecture

```
[Message.tsx speaker button]
        │
        ▼
[TTSService interface]   ← single call site, swappable engine
        │
   ┌────┴────────────┐
   ▼                 ▼
PiperTTS         GeminiTTS          (fallback — see Phase 5)
(IPC → main.ts   (IPC → main.ts →
→ spawn piper    Gemini API →
→ .wav buffer)   audio blob)
```

---

## Voice Model — How It Works

Piper TTS is a standalone binary (C++, no Python, cross-platform). Each voice is two files:

```
en_US-amy-medium.onnx          ← neural model (~65 MB)
en_US-amy-medium.onnx.json     ← config (a few KB)
```

Models are downloaded from the open Piper voices library (Hugging Face). The user picks the
language and quality tier they want — same mental model as pulling an Ollama model.

**Hackathon story:** "The app ships with one English voice. Parents can drop in any Piper voice
file for Spanish, French, Mandarin, etc. — it's detected automatically. No subscriptions,
no API keys, fully offline."

**Bundled default:** `en_US-amy-medium` (65 MB, good quality, natural for kids).
**High-quality option:** `en_US-lessac-high` (130 MB) if bundle size allows.

### Language Support

30+ languages including Spanish, French, German, Italian, Portuguese, Mandarin, Japanese,
Korean, Arabic, Russian, Polish, Dutch, Swedish. English and major European languages have
the strongest quality. Quality varies for smaller languages.

### Quality Tiers

| Tier | File size | Quality |
|---|---|---|
| `low` | ~25 MB | Acceptable, slight robotic edge |
| `medium` | ~65 MB | Good — natural enough for a kids' app |
| `high` | ~130 MB | Very good — smooth, natural prosody |

---

## Files Affected

| File | Change |
|---|---|
| `scripts/test-piper.mjs` | NEW — standalone pipeline + quality test (run before integration) |
| `src/renderer/services/TTSService.ts` | NEW — interface + factory |
| `src/renderer/services/PiperTTS.ts` | NEW — Piper child-process implementation |
| `src/renderer/components/Message.tsx` | ADD speaker button on assistant messages |
| `src/renderer/styles.css` | ADD button styles (kid-friendly, accessible) |
| `src/main/main.ts` | ADD IPC handler `tts-speak` — spawns Piper, returns WAV buffer |
| `src/main/preload.ts` | ADD expose `window.electronAPI.ttsSpeak` |
| `src/renderer/global.d.ts` | ADD type for `window.electronAPI.ttsSpeak` |
| `src/renderer/services/GeminiTTS.ts` | FUTURE — Gemini fallback implementation |

No new npm packages required.

---

## Phase 0 — Test Pipeline First (before any integration)

**File:** `scripts/test-piper.mjs`

Run this standalone script to verify Piper works on the target machine and evaluate voice
quality before writing any app code.

```bash
node scripts/test-piper.mjs --binary ./piper --model ./en_US-amy-medium.onnx
```

The script:
1. Checks the binary and model files exist and are readable
2. Runs Piper with 5 kid-friendly test phrases (short, medium, code explanation, encouragement, excited)
3. Writes each result as a numbered `.wav` file in `scripts/tts-test-output/`
4. Prints pass/fail per phrase with timing (ms per phrase)
5. Prints a summary — total time, average latency, whether output files are non-empty

Play the `.wav` files manually to judge quality. If quality is acceptable, proceed to Phase 1.

---

## Phase 1 — TTSService Abstraction

**File:** `src/renderer/services/TTSService.ts`

```typescript
export interface TTSService {
  speak(text: string): Promise<void>;
  cancel(): void;
  readonly speaking: boolean;
}

export function createTTSService(): TTSService {
  return new PiperTTS();   // swap to GeminiTTS here if needed
}
```

Rules:
- `speak()` returns a Promise — resolves when audio finishes, rejects on error
- `cancel()` stops current audio immediately
- `speaking` lets the button toggle between play and stop icon

---

## Phase 2 — PiperTTS Implementation

**File:** `src/renderer/services/PiperTTS.ts`

Flow:
1. Strip Markdown from text before sending to Piper
2. Call `window.electronAPI.ttsSpeak(cleanText)` → returns `ArrayBuffer` (WAV)
3. Play buffer via `AudioContext` + `decodeAudioData`
4. Resolve promise when playback ends, reject on error

**IPC handler in `main.ts`:**
- Receives text string
- Spawns Piper binary with `--model` path and `--output-raw` flag
- Writes text to stdin
- Collects stdout as WAV bytes
- Returns buffer to renderer

**Piper binary + model paths** resolved via `app.getPath('userData')` — user drops files there.
App checks on startup if binary + at least one `.onnx` model exist; shows setup instructions if not.

---

## Phase 3 — Speaker Button in Message.tsx

The button appears **only on assistant messages**, not user messages.

**Behaviour:**
- Idle: shows 🔊 icon, `aria-label="Read aloud"`
- Speaking: shows ⏹ icon, clicking cancels immediately
- Disabled: while message is still streaming

**Placement:** bottom-right corner of the assistant message bubble.

**Props change:**
```typescript
interface Props {
  role: string;
  content: string;
  streaming?: boolean;
  tts?: TTSService;   // passed down from ChatPanel
}
```

`ChatPanel.tsx` creates one `TTSService` instance via `useMemo` and passes it to each `<Message>`.

---

## Phase 4 — Multi-language Voice Detection (bonus)

On startup, `main.ts` scans `app.getPath('userData')` for `*.onnx` files.
Detected voices are passed to the renderer via IPC.
A small voice picker (dropdown or auto-select based on system locale) lets families choose
their downloaded language without restarting.

---

## Phase 5 — Gemini TTS Fallback (if Piper quality is unacceptable)

**Trigger:** Piper voice quality fails on demo hardware after Phase 0 test.
**Estimated effort:** 2–3 hours.

Steps:
1. Add `GEMINI_API_KEY` to Electron env (loaded in `main.ts` via `process.env`)
2. Add IPC handler `tts-speak-gemini` in `main.ts` — calls Gemini 2.5 Flash TTS, returns `ArrayBuffer`
3. Write `GeminiTTS.ts` implementing `TTSService` — calls IPC, plays via `AudioContext`
4. Swap factory in `TTSService.ts`

No renderer CSP changes needed — API call is in main process (Node.js).
**CLAUDE.md note:** "localhost:11434 only" rule needs a one-line exception if this path is taken.

---

## Acceptance Criteria

- [ ] `scripts/test-piper.mjs` runs clean and produces audible `.wav` files
- [ ] Gemma assistant messages have a visible speaker button
- [ ] Clicking speaks the full message text aloud (Markdown stripped)
- [ ] Clicking again while speaking cancels immediately
- [ ] Button is disabled while message is still streaming
- [ ] No speech fires automatically — always user-initiated
- [ ] App shows clear setup instructions if Piper binary or model is missing
- [ ] `npm run build` and `npm run typecheck` pass clean

---

## Out of Scope (this plan)

- Auto-read new messages without clicking
- Per-voice settings UI
- Speed/pitch controls
- Gemini TTS (Phase 5 is contingent on Phase 0 test results)
