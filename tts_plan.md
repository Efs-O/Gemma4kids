# TTS Voice Plan — Gemma4kids

**Date:** 2026-04-27
**Feature:** Text-to-Speech output for Gemma's responses
**Primary engine:** Piper TTS (offline, child-process from Electron main, no CSP changes)
**Fallback:** Gemini 2.5 Flash TTS via Electron main process IPC (approved — see Phase 5)

---

## Decisions (locked — implement these exactly)

| # | Decision | Detail |
|---|---|---|
| 1 | **Piper binary location** | Check `<projectRoot>/piper/piper.exe` first (dev convenience), then `app.getPath('userData')/piper/piper.exe` (prod). Windows = `piper.exe`, POSIX = `piper`. |
| 2 | **Voice models location** | `app.getPath('userData')/voices/` — user drops `.onnx` + `.onnx.json` pairs there. Dev: also check `<projectRoot>/voices/`. |
| 3 | **Languages to ship** | English `en_US-lessac-high` (130 MB), German `de_DE-thorsten-high` (130 MB), Greek `el_GR-rapunzel-medium` (65 MB — no high tier exists for Greek). |
| 4 | **Sample rate** | Read `audio.sample_rate` from `.onnx.json` — never hardcode. WAV header must use the model's actual rate. |
| 5 | **Download script** | `scripts/download-voices.mjs` — fetches all 3 voice pairs from HuggingFace. `npm run download-voices`. |
| 6 | **Phase 5 Gemini fallback** | Approved. Implement only if Piper quality is unacceptable on demo hardware. |
| 7 | **stdin input** | Plain text stdin (no `--json-input` flag — not universally supported). Strip Markdown before sending. |
| 8 | **IPC return type** | Main returns `Buffer`. Renderer casts to `ArrayBuffer` via `.buffer` on the received `Uint8Array`. |

---

## Why a Speaker Button?

- Kids aged 6–11 may struggle to read longer explanations
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
PiperTTS         GeminiTTS          (Phase 5 — approved, contingent)
(IPC → main.ts   (IPC → main.ts →
→ spawn piper    Gemini API →
→ WAV buffer)    audio blob)
```

---

## Voice Models

### Voices to download (`npm run download-voices`)

| Language | Model | Tier | Size |
|---|---|---|---|
| English | `en_US-lessac-high` | high | ~130 MB |
| German | `de_DE-thorsten-high` | high | ~130 MB |
| Greek | `el_GR-rapunzel-medium` | medium | ~65 MB |

> Greek has no `high` tier in the Piper library — `medium` is the best available.

HuggingFace base: `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/`

Paths:
- `en/en_US/lessac/high/en_US-lessac-high.onnx` + `.onnx.json`
- `de/de_DE/thorsten/high/de_DE-thorsten-high.onnx` + `.onnx.json`
- `el/el_GR/rapunzel/medium/el_GR-rapunzel-medium.onnx` + `.onnx.json`

### Quality Tiers

| Tier | Size | Quality |
|---|---|---|
| `low` | ~25 MB | Acceptable, slight robotic edge |
| `medium` | ~65 MB | Good — natural enough for a kids' app |
| `high` | ~130 MB | Very good — smooth, natural prosody |

---

## Files to Create / Modify

| File | Change |
|---|---|
| `scripts/download-voices.mjs` | NEW — downloads all 3 voice pairs from HuggingFace |
| `scripts/test-piper.mjs` | UPDATE — read sample rate from `.onnx.json`, not hardcoded 22050 |
| `src/renderer/services/TTSService.ts` | NEW — interface + factory |
| `src/renderer/services/PiperTTS.ts` | NEW — Piper IPC client + AudioContext playback |
| `src/renderer/components/Message.tsx` | ADD speaker button on assistant messages |
| `src/renderer/styles.css` | ADD `.btn-speaker` styles |
| `src/main/main.ts` | ADD `tts-speak` IPC handler |
| `src/main/preload.ts` | ADD `window.electronAPI.ttsSpeak` |
| `src/renderer/global.d.ts` | ADD type for `ttsSpeak` |
| `src/renderer/services/GeminiTTS.ts` | FUTURE — Phase 5 only |
| `package.json` | ADD `download-voices` script |

---

## Phase 0 — Test Pipeline ✅ (voices tested on Piper site — sound good)

Re-run `test-piper.mjs` after downloading the binary and models to confirm local pipeline.
**Fix needed in test script:** read sample rate from `.onnx.json → audio.sample_rate`
instead of hardcoded 22050.

```bash
npm run download-voices
node scripts/test-piper.mjs \
  --binary ./piper/piper \
  --model ./voices/en_US-lessac-high.onnx
```

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
  return new PiperTTS();
}
```

Rules:
- `speak()` resolves when audio finishes, rejects on error
- `cancel()` stops current audio immediately
- `speaking` drives the button icon toggle

---

## Phase 2 — PiperTTS Implementation

**File:** `src/renderer/services/PiperTTS.ts`

Flow:
1. Strip Markdown (remove `**`, `*`, `` ` ``, `#`, `>`, `[]()` links, `✨` notes)
2. Call `window.electronAPI.ttsSpeak(cleanText)` → receives `Uint8Array`
3. Cast: `uint8arr.buffer` → `ArrayBuffer`
4. `AudioContext.decodeAudioData(buffer)` → `AudioBufferSourceNode` → play
5. Resolve on `source.onended`, reject on decode error

**IPC handler `tts-speak` in `main.ts`:**
1. Resolve binary: check `<app.getAppPath()>/piper/piper[.exe]` (dev), then `userData/piper/piper[.exe]` (prod)
2. Find first `.onnx` in `<app.getAppPath()>/voices/` (dev) or `userData/voices/` (prod)
3. Read `.onnx.json` → `audio.sample_rate`
4. Spawn: `piper --model <path> --output-raw`, write text to stdin
5. Collect stdout → `Buffer.concat(chunks)`
6. Prepend 44-byte WAV header (mono, 16-bit LE, correct sample rate)
7. Return buffer via IPC

---

## Phase 3 — Speaker Button in Message.tsx

Button on **assistant messages only**, hidden while streaming.

States:
- Idle → `🔊` (`aria-label="Read aloud"`)
- Speaking → `⏹` (click cancels)

**Placement:** bottom-right of assistant bubble, `position: absolute`.

```typescript
// Message.tsx props
interface Props {
  role: string;
  content: string;
  streaming?: boolean;
  tts?: TTSService;
}
```

`ChatPanel.tsx` creates **one** `TTSService` via `useMemo(() => createTTSService(), [])`,
passed to every `<Message>`. Calling `speak()` while another message plays implicitly
cancels it (cancel then play).

---

## Phase 4 — Multi-language Voice Detection

`tts-list-voices` IPC on startup:
- Scan `userData/voices/` + project `voices/` for `*.onnx` + matching `.onnx.json`
- Return `{ name, lang, sampleRate }[]` to renderer
- Auto-select: match `app.getLocale()` → first English → first available
- No voice-picker UI needed for hackathon

---

## Phase 5 — Gemini TTS Fallback (approved, contingent on Phase 0 results)

1. `GEMINI_API_KEY` in Electron main via `process.env`
2. IPC `tts-speak-gemini` — calls Gemini 2.5 Flash TTS, returns `ArrayBuffer`
3. `GeminiTTS.ts` — same `TTSService` interface, swap in factory
4. CLAUDE.md: add one-line exception for `generativelanguage.googleapis.com` from main process

---

## Acceptance Criteria

- [ ] `npm run download-voices` fetches all 3 voice pairs without error
- [ ] `test-piper.mjs` passes all 5 phrases, `.wav` files are audible
- [ ] Assistant messages show a 🔊 speaker button (not on user messages, not while streaming)
- [ ] Clicking speaks the full message text aloud (Markdown stripped)
- [ ] Clicking again while speaking cancels immediately
- [ ] No speech fires automatically — always user-initiated
- [ ] `npm run build` and `npm run typecheck` pass clean

---

## Out of Scope

- Auto-read new messages without clicking
- Per-voice settings UI, speed/pitch controls
- Gemini TTS unless Piper fails on demo hardware
