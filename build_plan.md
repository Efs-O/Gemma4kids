---
name: gemma4kids full build plan
description: Day-by-day 22-day build plan for the gemma4kids hackathon submission, including voice pipeline
type: project
originSessionId: 62dcaf2f-5c89-46f4-a084-24b0edb2880b
---
**Rule:** Build target is Day 15 (working app). Days 16β€“22 are video + writeup + submission.
**Judging:** Impact/Vision 40pts, Video 30pts, Technical Depth 30pts. 70pts ride on the video.

---

## Progress Tracker (updated 2026-04-27)

| Phase | Days | Status | Notes |
|---|---|---|---|
| Scaffold | 1β€“2 | β… Done | Committed: Electron shell, React, CodeMirror 6, all 4 IPC handlers, preload, global.d.ts, Forge llm/ files |
| LLM + Chat | 3β€“5 | β… Done | OllamaService, tools.ts, prompts.ts, useOllama, ErrorBoundary, useChat (full agentic loop), VoiceInput, ProjectList, App rebuilt, build+typecheck green |
| Editor + Save/Preview | 6β€“8 | β… Done | CodeMirror done in Day 2; IPC handlers fully wired in Day 2; ProjectList sidebar done in Day 5 β€” this phase is complete |
| Kids UX Polish | 9β€“12 | β¬ Next | Visual design, onboarding cards, kid-friendly errors, follow-up prompt chips |
| Cross-Platform + Packaging | 13β€“15 | β¬ Pending | electron-builder, icons, macOS entitlements |
| Submission | 16β€“22 | β¬ Pending | GitHub, video, Kaggle writeup |

**Current position: End of Phase 3 (Day 8 equivalent). 3 calendar days used. ~18 days remaining.**
**Next session: Day 9 β€” visual design polish, onboarding screen, kid-friendly error states.**

---

## Phase 1 β€” Scaffold (Days 1β€“2)

**Day 1**
- `npm init` in `Gemma4kids/`
- Install: `electron`, `react`, `react-dom`, `typescript`, `esbuild`, `@types/react`, `@types/react-dom`, `electron-builder`
- `tsconfig.json` β€” two targets: `main` (Node/CJS) and `renderer` (browser/ESM)
- `esbuild.config.mjs` β€” two build scripts: `build:main`, `build:renderer`
- `src/main/main.ts` β€” Electron entry, creates BrowserWindow (800Γ—600)
- `src/renderer/index.html` + `src/renderer/App.tsx` β€” bare React shell
- `package.json` scripts: `dev`, `build`, `dist`
- **CSP** in `index.html` meta: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:11434` β€” Ollama localhost only, no remote network reachable from the renderer
- Verify: `npm run dev` opens a window

**Day 2**
- Copy `OpenAIClient.ts`, `types.ts`, `cancellation.ts` from Forge β†’ `src/renderer/llm/`
- Install: `codemirror`, `@codemirror/lang-html`, `@codemirror/theme-one-dark`
- Stub `OllamaService.ts` β€” `getModels()` hits `GET localhost:11434/api/tags`
- Stub `ipcMain` handlers in `main.ts`: `save-file`, `open-in-browser`
- Stub `ipcRenderer` wrapper in `src/renderer/ipc.ts`
- `ErrorBoundary.tsx` β€” class component wrapping `<App />`. Catches CodeMirror/render exceptions, shows kid-friendly fallback ("Oops! Press the refresh button to try again."). Without this, one editor crash white-screens the whole renderer.
- Verify: TypeScript compiles clean

---

## Phase 2 β€” LLM + Chat (Days 3β€“5)

**Day 3 β€” Ollama connection + Tool definitions**
- `OllamaService.ts`:
  - `getModels()` β†’ parse `/api/tags`, filter gemma4 variants
  - `isRunning()` β†’ health check via GET /api/tags
  - `transcribe(audioBase64: string): Promise<string>` β†’ POST to E4B with audio in `images` field, `keep_alive: 0`, non-streaming β€” returns transcription text
- `tools.ts` β€” defines the 4 Gemma tools as `ToolDefinition[]` (OpenAI JSON schema format, passed in `tools` field of every 26b request):
  ```
  save_animation(filename: string, html_content: string)
    β†’ "Save or overwrite an HTML animation file"
  read_animation(filename: string)
    β†’ "Read an existing animation file so you can edit it"
  list_animations()
    β†’ "List all saved animation filenames"
  open_in_browser(filename: string)
    β†’ "Open a saved animation in the browser"
  ```
- Ollama applies the Gemma 4 Jinja chat template server-side β€” tools array is all we pass
- `useOllama.ts` hook β€” checks if Ollama running on mount, shows friendly error if not
- Model selector shows two separate slots:
  - Voice model: `gemma4:e4b` (9.6GB, required for mic button)
  - Coding model: `gemma4:26b` (fallback: `gemma4:e4b` if 26b not present)
- Startup screen if Ollama not found: "Ask a grown-up to start Ollama!"

**Day 4 β€” Chat engine + Agentic tool loop**
- `useChat.ts` hook:
  - Maintains `messages: ChatMessage[]`
  - `sendMessage(text)` β†’ **streaming always ON** via `streamChatCompletion` to `gemma4:26b` (`stream: true`) with `tools` array attached β€” tokens appear in real time
  - Code extraction happens on the final assembled response, not mid-stream
  - Extracts ```html code block from assembled text β†’ exposes `latestCode: string | null`
  - Editor updates once after stream completes, not on every token
  - `cancel()` via `CancellationToken` β€” stop button kills the stream mid-generation
- **Agentic tool loop** β€” `onToolCalls` handler (already in Forge's OpenAIClient.ts, zero changes needed):
  - When Gemma calls a tool, dispatch via IPC to main process
  - Append tool result as `{ role: 'tool', content: result, name: fn }` to messages
  - Re-call `streamChatCompletion` with updated messages β€” Gemma generates final reply
  - Loop continues until Gemma returns a plain text response (no more tool calls)
  - Example flows:
    - "make a tree and save it" β†’ Gemma calls `save_animation` β†’ IPC saves file β†’ Gemma: "Done! I saved tree.html"
    - "add more leaves" β†’ Gemma calls `read_animation` β†’ gets current HTML β†’ calls `save_animation` with updated HTML
    - "show me what I made" β†’ Gemma calls `list_animations` β†’ returns filenames β†’ Gemma: "You have: ball.html, tree.html"
- Note: `transcribe()` on E4B is the only non-streaming call (need full text before routing to 26b)
- System prompt in `prompts.ts`:
  - Always simple language for ages 7β€“12
  - Always use tools to save/read/open β€” never ask the kid to click Save manually
  - Always include full HTML in `save_animation` β€” never partial code
  - Fun, colorful animations
- **Conversation truncation** in `useChat.ts` before each `streamChatCompletion` call: keep system prompt + last 10 user/assistant pairs + last 4 tool results. Older messages dropped silently. Prevents context-window blowout on smaller models during long teaching sessions (20+ turns Γ— full HTML in tool results gets huge fast).

**Day 5 β€” Chat UI + Voice input**
- `ChatPanel.tsx`: message list, large rounded input, streaming dots, stop button, AI avatar (SVG robot)
- `MessageBubble.tsx`: renders text, hides raw code block (code goes to editor)
- `VoiceInput.tsx` β€” mic button wired to E4B pipeline:
  - States: idle β†’ recording (red pulse animation) β†’ transcribing (spinner) β†’ done
  - Uses `MediaRecorder` API to capture audio as WAV
  - Calls `OllamaService.transcribe()` β†’ E4B with `keep_alive: 0`
  - E4B unloads from VRAM immediately after transcription
  - Short pause (~2s) to let VRAM clear, then transcribed text auto-sends to 26b
  - Retry logic: on GGML crash error, wait 8s and retry once automatically
  - If E4B not installed: mic button is disabled with tooltip "Install gemma4:e4b for voice"
  - Graceful degradation: text input always works regardless of voice status

---

## Phase 3 β€” Editor + Save/Preview (Days 6β€“8)

**Day 6 β€” CodeMirror**
- `CodeEditor.tsx`: CodeMirror 6, HTML+JS highlighting, One Dark theme, 15px font, line numbers
- Wire: when `latestCode` changes β†’ `editor.dispatch({ changes: ... })`
- Kid can also edit manually
- **Budget realism: plan 1.5β€“2 days, not 1.** CodeMirror 6 + React refs has known footguns (StrictMode double-mounts, dispatch-after-unmount). Guard every dispatch: `if (viewRef.current) { viewRef.current.dispatch(...) }`. Cleanup useEffect must call `view.destroy()`. If Day 6 runs over, push IPC work (Day 7) to Day 7β€“8.

**Day 7 β€” IPC handlers for all 4 Gemma tools**
- `main.ts` IPC handlers (used by BOTH manual save button AND Gemma tool calls):
  - `save-animation` β†’ receives `{ filename, html_content }`, saves to `app.getPath('documents')/KidAnimations/<filename>.html`, creates folder if not exists, returns `{ success: true, path: string }`
  - `read-animation` β†’ receives `{ filename }`, returns `{ success: true, content: string }` or error
  - `list-animations` β†’ reads KidAnimations/ dir, returns `{ files: string[] }`
  - `open-in-browser` β†’ receives `{ filename }`, calls `shell.openExternal('file://' + path)`
- `ipc.ts` renderer wrappers for all 4: `saveAnimation()`, `readAnimation()`, `listAnimations()`, `openInBrowser()`
- `SaveBar.tsx`: manual save button still present β€” filename input (auto-increments), calls `saveAnimation()` directly, success toast "Saved!"
- Tool dispatch in `useChat.ts` routes Gemma tool calls to the same IPC wrappers
- **Filename collision strategy** in `save-animation` IPC: if target file exists AND content differs, append `-2`, `-3`, etc. Tool result returns the *actual* saved filename so Gemma's next `read_animation` uses the right name. Prevents Gemma from silently overwriting `untitled.html` 30 times in one session.

**Day 8 β€” Browser preview + project list**
- "Open in Browser" button in SaveBar β€” calls `openInBrowser()` IPC, enabled after save
- `ProjectList.tsx`: sidebar showing saved projects from `listAnimations()`, click to load into editor
- When Gemma calls `open_in_browser` tool, same IPC fires β€” kid sees browser open automatically
- **AI-generated HTML safety model:** files open in user's default browser (Chrome on most machines β€” Google brand alignment). `file://` origin can't reach `localhost:11434` (CORS), browser sandbox limits damage, and the system prompt forbids network calls in generated HTML. No iframe inside the renderer process β€” keeps untrusted JS out of Electron's main world.
- **Optional Chrome-detection** in `openInBrowser` IPC: try `spawn('chrome.exe' / 'open -a "Google Chrome"')` first, fall back to `shell.openExternal` if Chrome not found. Maximizes the Google-brand moment in the demo.

---

## Phase 4 β€” Kids UX Polish (Days 9β€“12)

**Day 9 β€” Visual design**
- Palette: warm white bg, deep purple sidebar, green accents, coral buttons
- Font: Inter or system-ui, large sizes, min 44px touch targets
- No jargon: "Your Code" not "Editor", "Open in Browser" not "Preview"

**Day 10 β€” Onboarding**
- First launch: "Hi! I'm Gemma, your coding buddy!"
- Three example prompt cards: "Make a bouncing ball", "Make snowflakes fall", "Make fireworks explode"
- Clicking a card fills input and sends it
- Empty editor: faint placeholder text

**Day 11 β€” Kid-friendly errors**
- Ollama not running β†’ friendly message, no stack traces ever
- Model not found β†’ exact `ollama pull` command shown
- Voice crash (GGML) β†’ silent retry, kid sees "thinking..." not an error
- Generation error β†’ retry button

**Day 12 β€” Prompt suggestions + voice polish**
- After AI responds: 3 follow-up chips ("Make it faster", "Change color to red", "Add music notes")
- Session conversation history in memory (not saved to disk)
- Voice: test E4B audio pipeline end-to-end, tune retry logic, verify VRAM offload timing

---

## Phase 5 β€” Cross-Platform + Packaging (Days 13β€“15)

**Day 13 β€” electron-builder**
- `electron-builder.yml`: Windows (NSIS), macOS (DMG+zip), Linux (AppImage)
- Icons: icon.ico, icon.icns, icon.png from one source SVG
- Build scripts: `dist:win`, `dist:mac`, `dist:linux`
- Verify `MediaRecorder` WAV output works in Electron's Chromium on all platforms
- **macOS entitlements** in `electron-builder.yml` under `mac.extendInfo`:
  - `NSMicrophoneUsageDescription`: "Gemma4kids uses your microphone so you can talk to your coding teacher."
  - `NSDocumentsFolderUsageDescription`: "Gemma4kids saves your animations to your Documents folder."
  - Without these, mic access on macOS silently fails β€” no permission prompt ever appears.
- **Code signing β€” ship UNSIGNED for hackathon** (no $99 Apple dev account, no $300+ Windows EV cert in 22 days). Pre-warn judges in SETUP.md, framed as "indie/hackathon build" not "sketchy":
  - Windows: SmartScreen warning β†’ "More info" β†’ "Run anyway"
  - macOS: "Cannot verify developer" β†’ right-click app β†’ Open β†’ confirm

**Pay attention:** unsigned is correct for the hackathon, local testing, and judge delivery, but any real public release should be signed. On Windows, signing reduces SmartScreen and "unknown publisher" warnings and is important for parent, school, and enterprise trust. On macOS, proper public release means Apple Developer signing and, in practice, notarization to avoid Gatekeeper install friction. When Gemma4kids moves from hackathon build to public launch, re-enable the Windows signing/edit path and add real signing configuration instead of shipping unsigned.
**Day 14 β€” Platform testing**
- Test Windows: install β†’ full text flow β†’ full voice flow
- Test macOS (if Mac available): install β†’ full text flow β†’ full voice flow. **Fallback:** if no Mac by Day 14, document "macOS build untested due to hackathon deadline β€” code is portable but not validated on Apple hardware" in SETUP.md and README. Honesty > overclaiming; judges respect transparency.
- `app.getPath('documents')` for cross-platform Documents path
- `path.join` everywhere, no hardcoded separators
- `SETUP.md` with platform-specific Ollama instructions + both model pull commands

**Day 15 β€” Final functional check (golden path)**
1. Install app β†’ Install Ollama β†’ `ollama pull gemma4:e4b` β†’ `ollama pull gemma4:26b` β†’ Launch
2. Press mic β†’ say "make a bouncing ball" β†’ transcription appears β†’ code generated
3. OR type "make a bouncing ball" β†’ code appears in editor
4. Save β†’ Open in Browser β†’ bouncing ball visible
- All errors are kid-friendly, no crashes, voice degrades gracefully if E4B absent

---

## Phase 6 β€” Submission (Days 16β€“22)

**Day 16β€“17 β€” GitHub repo**
- Public repo: `gemma4kids`
- README: what it is, screenshot, quick start, architecture, why Gemma 4
- Well-commented: useChat.ts, OllamaService.ts, VoiceInput.tsx, system prompt
- SETUP.md: dependency instructions + both `ollama pull` commands for judges

**Day 18β€“19 β€” Video (3 min, YouTube)**
- 0:00β€“0:30 The problem (kid frustrated, bad internet, expensive subscriptions)
- 0:30β€“0:45 Introduce app β€” show the clean UI, the mic button
- 0:45β€“1:30 KILLER MOMENT: kid presses mic, says "make fireworks explode" β€” 26b generates live, fireworks appear in browser. WiFi is OFF the whole time.
- 1:30β€“2:00 Kid modifies: presses mic again, says "make them blue" β€” update appears
- 2:00β€“2:30 Show it's offline: WiFi indicator off, everything still works. "No internet. No subscription. No data sent anywhere."
- 2:30β€“3:00 Vision: "Every kid deserves a coding teacher."
- Record 1080p, app window large, upload to YouTube (unlisted OK)

**Day 20 β€” Kaggle writeup (max 1,500 words)**
1. The Problem (150w)
2. Solution Overview (200w)
3. How Gemma 4 Is Used (300w) β€” E4B for voice STT, 26b for code generation + native tool calling, VRAM offload pipeline, base64 WAV via images field, Jinja chat template handled by Ollama server-side
4. Architecture (300w)
5. Challenges & Solutions (200w) β€” GGML crash retry, VRAM offload timing, agentic tool loop, full-file in save_animation
6. Impact & Future (150w)

**Day 21 β€” Buffer:** re-test installers, proofread, review video audio
**Day 22 β€” Submit:** Kaggle writeup, verify all links public

---

## Voice Pipeline β€” Technical Detail

```
[Mic button pressed]
  β†’ MediaRecorder captures WAV
  β†’ base64 encode
  β†’ POST /api/chat { model: "gemma4:e4b", messages: [{ role: "user", content: "Transcribe exactly what the child said.", images: ["<base64-wav>"] }], keep_alive: 0, stream: false }
  β†’ E4B returns transcription text
  β†’ E4B unloads from VRAM (keep_alive: 0)
  β†’ wait ~2s
  β†’ transcription text β†’ sendMessage() β†’ 26b generates HTML code
  β†’ code appears in CodeMirror editor
```

**Known issue:** GGML assertion crash on E4B audio, intermittent (~1 in 3 requests). Auto-recovers in 6β€“8s. Mitigation: catch error, show "thinking...", retry once after 8s delay.

---

## File Structure

```
Gemma4kids/
β”β”€β”€ src/
β”‚   β”β”€β”€ main/main.ts
β”‚   β””β”€β”€ renderer/
β”‚       β”β”€β”€ index.html
β”‚       β”β”€β”€ App.tsx
β”‚       β”β”€β”€ llm/          β† OpenAIClient.ts, types.ts, cancellation.ts (from Forge)
β”‚       β”β”€β”€ hooks/        β† useChat.ts, useOllama.ts
β”‚       β”β”€β”€ services/     β† OllamaService.ts (includes transcribe())
β”‚       β”β”€β”€ components/   β† ChatPanel, MessageBubble, CodeEditor, SaveBar,
β”‚       β”‚                    ModelSelector, ProjectList, OnboardingScreen,
β”‚       β”‚                    VoiceInput
β”‚       β”β”€β”€ prompts.ts
β”‚       β”β”€β”€ tools.ts      β† 4 ToolDefinition objects for Gemma tool calling
β”‚       β””β”€β”€ ipc.ts        β† saveAnimation, readAnimation, listAnimations, openInBrowser
β”β”€β”€ assets/icon.svg
β”β”€β”€ tsconfig.json
β”β”€β”€ esbuild.config.mjs
β”β”€β”€ package.json
β”β”€β”€ electron-builder.yml
β”β”€β”€ SETUP.md
β””β”€β”€ README.md
```

---

## Confirmed Ollama Model Tags

| Model | Tag | Size | Use |
|---|---|---|---|
| Voice / STT | `gemma4:e4b` | 9.6GB | Audio transcription, keep_alive:0 |
| Coding | `gemma4:26b` | ~17GB | HTML code generation, streaming |
| Fallback | `gemma4:e4b` | 9.6GB | Coding if 26b absent |

---

## Key Technical Decisions

| Decision | Why |
|---|---|
| Ollama over llama.cpp direct | Single installer, Windows service, no PATH setup |
| CodeMirror 6 over Monaco | 200KB vs 4MB, simpler React mounting |
| Always full-file replacement | No diff/patch complexity; kids can't debug partial code |
| Electron over web app | Offline-first; file system; no server cost; matches pitch |
| System prompt forces complete HTML | Prevents partial code that won't run |
| E4B for STT + 26b for code | E4B native audio encoder; 26b better code quality; VRAM offload via keep_alive:0 |
| Audio via images field | Ollama reuses images[] field for base64 audio; WAV format confirmed |
| keep_alive:0 on E4B | Forces immediate VRAM unload so 26b can load cleanly |
| Gemma native tool calling | 26b calls save/read/list/open tools directly β€” kid says "save it" and it happens, no button click needed |
| 4 IPC handlers shared | Same handlers serve both manual Save button and Gemma tool calls β€” one source of truth |
| Jinja template server-side | Ollama applies Gemma 4 chat template automatically β€” we only pass the tools[] array |
| onToolCalls already in Forge | OpenAIClient.ts streams and accumulates tool_calls with zero changes β€” reuse as-is |

---

## Tool Calling β€” Agentic Loop Detail

```
sendMessage("make a tree with animated leaves and save it")
  β†’ streamChatCompletion({ model: "gemma4:26b", messages, tools: KIDS_TOOLS, stream: true })
  β†’ onToolCalls fires: [{ name: "save_animation", arguments: { filename: "tree", html_content: "<!DOCTYPE..." } }]
  β†’ ipcRenderer.invoke('save-animation', { filename: "tree", html_content })
  β†’ main.ts writes file β†’ returns { success: true, path: ".../tree.html" }
  β†’ messages.push({ role: "tool", content: '{"success":true}', name: "save_animation" })
  β†’ streamChatCompletion again with updated messages
  β†’ Gemma: "I made your tree and saved it! Press Open to watch the leaves dance."

sendMessage("add more leaves to the tree")
  β†’ Gemma calls read_animation({ filename: "tree" })
  β†’ IPC returns current HTML content
  β†’ Gemma calls save_animation with updated HTML (more leaves added)
  β†’ Gemma: "Done! I added more leaves to your tree."
```

**How to apply:** Reference this plan at the start of each build session to pick up where we left off.
