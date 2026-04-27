# TTS Voice Plan — Gemma4kids

**Date:** 2026-04-27  
**Feature:** Text-to-Speech output for Gemma's responses  
**Default engine:** `window.speechSynthesis` (Web Speech API — offline, no CSP changes)  
**Swap path:** Gemini 2.5 Flash TTS via Electron main process IPC (if voice quality is unacceptable)

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
   ┌────┴────┐
   ▼         ▼
SpeechSyn-  GeminiTTS        (future swap — see Phase 4)
thesisTTS   (IPC → main.ts → Gemini API → audio blob)
```

---

## Files Affected

| File | Change |
|---|---|
| `src/renderer/services/TTSService.ts` | NEW — interface + singleton factory |
| `src/renderer/services/SpeechSynthesisTTS.ts` | NEW — Web Speech API implementation |
| `src/renderer/components/Message.tsx` | ADD speaker button on assistant messages |
| `src/renderer/styles.css` | ADD button styles (kid-friendly, accessible) |
| `src/main/main.ts` | FUTURE — IPC handler for Gemini TTS audio |
| `src/main/preload.ts` | FUTURE — expose `window.electronAPI.ttsSpeak` |
| `src/renderer/global.d.ts` | FUTURE — type for `window.electronAPI.ttsSpeak` |
| `src/renderer/services/GeminiTTS.ts` | FUTURE — Gemini implementation |

No new npm packages required for Phase 1–3.

---

## Phase 1 — TTSService Abstraction

**File:** `src/renderer/services/TTSService.ts`

```typescript
export interface TTSService {
  speak(text: string): void;
  cancel(): void;
  readonly speaking: boolean;
}

// Factory — swap engine here when ready
export function createTTSService(): TTSService {
  return new SpeechSynthesisTTS();   // import in actual file
}
```

Rules:
- `speak()` is fire-and-forget — no promise needed for Phase 1
- `cancel()` stops current speech immediately
- `speaking` lets the button toggle between a play and stop icon

---

## Phase 2 — SpeechSynthesisTTS Implementation

**File:** `src/renderer/services/SpeechSynthesisTTS.ts`

Key behaviour:
- Strip Markdown before speaking (`content.replace(/[#*`_~]/g, '')`)
- Pick the best available voice: prefer `en-US` female voices, fallback to default
- Rate: `0.9` (slightly slower for kids), Pitch: `1.1` (slightly warmer)
- `cancel()` calls `window.speechSynthesis.cancel()`

Voice selection strategy (macOS gets neural Siri voices, Windows 11 gets neural Microsoft voices automatically — no extra work needed):

```typescript
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find(v => v.lang === 'en-US' && v.name.includes('Samantha')) || // macOS
    voices.find(v => v.lang === 'en-US' && v.name.includes('Jenny'))     || // Win11
    voices.find(v => v.lang.startsWith('en'))                            ||
    voices[0] || null
  );
}
```

---

## Phase 3 — Speaker Button in Message.tsx

The button appears **only on assistant messages**, not user messages.

**Behaviour:**
- Idle: shows 🔊 icon, labelled "Read aloud" (screen reader accessible)
- Speaking: shows ⏹ icon, clicking cancels speech
- Disabled + spinner: while Gemma is still streaming that message

**Placement:** bottom-right corner of the assistant message bubble.

**Message.tsx props change:**
```typescript
interface Props {
  role: string;
  content: string;
  streaming?: boolean;
  tts?: TTSService;      // passed down from ChatPanel
}
```

`ChatPanel.tsx` creates one `TTSService` instance (via `useMemo`) and passes it to each `<Message>`.

---

## Phase 4 — Gemini TTS Swap Path (future, if needed)

**Trigger:** Demo voice quality is judged unacceptable on target hardware.  
**Estimated effort:** 2–3 hours.

Steps:
1. Add `GEMINI_API_KEY` to Electron env (loaded in `main.ts` via `process.env`)
2. Add IPC handler `tts-speak` in `main.ts` — calls Gemini 2.5 Flash TTS endpoint, returns audio `ArrayBuffer`
3. Expose via `preload.ts` → `window.electronAPI.ttsSpeak(text)`
4. Add type in `global.d.ts`
5. Write `GeminiTTS.ts` implementing `TTSService` — calls IPC, plays returned buffer via `AudioContext`
6. In `TTSService.ts` factory, swap `SpeechSynthesisTTS` → `GeminiTTS`

**No renderer CSP changes needed** — the API call happens in main process (Node.js), not the renderer.  
**CLAUDE.md note:** The "localhost:11434 only" rule will need a one-line exception for Gemini TTS if this path is taken.

---

## Acceptance Criteria

- [ ] Gemma assistant messages have a visible speaker button
- [ ] Clicking speaks the full message text aloud (Markdown stripped)
- [ ] Clicking again while speaking cancels immediately
- [ ] Button is disabled/greyed while the message is still streaming
- [ ] No speech fires automatically — always user-initiated
- [ ] `npm run build` and `npm run typecheck` pass clean
- [ ] Tested on macOS and/or Windows 11 for voice quality

---

## Out of Scope (this plan)

- Auto-read new messages without clicking (too intrusive for kids)
- Per-voice settings UI
- Speed/pitch controls
- Gemini TTS integration (Phase 4 is contingent on demo results)
