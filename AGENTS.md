# CLAUDE.md — Gemma4kids

## Stack
Electron · React 18 · TypeScript · CodeMirror 6 · esbuild · Ollama (local model runtime).
No Python. No cloud. No subscriptions. No server. Offline-first by design.

---

## What This Project Is
Gemma4kids is an offline AI coding teacher for kids aged 8–12, built for the Google Gemma 4 Good
Hackathon (Kaggle, May 2026). A child types or speaks a prompt → Gemma generates a full HTML
animation live → kid sees the code, edits it, saves it, opens it in the browser. WiFi off the whole time.

**Priority split: 50% win the medal · 25% product launch · 25% career/acquisition.**
Default to scope discipline. Reject anything that serves the 25% goals but costs medal hours.

Models: `gemma4:e4b` (voice STT, 9.6 GB, `keep_alive: 0`) · `gemma4:26b` (code gen + tool calling, ~17 GB).
Ollama endpoint: `http://localhost:11434` — the only allowed outbound network target.

---

## Hard Stops — Never Do These
- No Python anywhere in the project
- No cloud LLM endpoints — Ollama `localhost:11434` only, always
- No outbound network calls from the renderer beyond `localhost:11434` (CSP in `index.html` enforces this — do not relax it)
- No `nodeIntegration: true` — `contextIsolation` must stay on
- No `iframe` inside the Electron renderer (untrusted AI-generated HTML opens in the user's browser via `shell.openExternal`, not in-app)
- Do not modify files in `src/renderer/llm/` — `OpenAIClient.ts`, `types.ts`, `cancellation.ts` are copied from Forge and used as-is
- No hardcoded OS paths — use `app.getPath('documents')` and `path.join` everywhere
- No new npm packages without asking — each adds bundle size and install risk
- No duplicate implementations — grep before creating anything new
- Do not implement beyond the current day's plan — check `build_plan.md` before creating new files

---

## Investigation Hard Limit
- Max 5 investigation steps before stopping
- Stop and ask the user at step 3 if direction is unclear
- Never silently pivot to a different approach mid-investigation

---

## File Size Limit
- 350 LOC max per source file where practical
- Split into modules if exceeded
- Does NOT apply to `.md`, `.json`, `.css`, config files, or generated files

---

## Single Point of Truth

| Concern | Owner |
|---|---|
| Electron main process + IPC handlers | `src/main/main.ts` |
| contextBridge IPC exposure | `src/main/preload.ts` |
| `window.electronAPI` types | `src/renderer/global.d.ts` |
| App state + streaming orchestration | `src/renderer/App.tsx` |
| Streaming OpenAI-compat client | `src/renderer/llm/OpenAIClient.ts` |
| Type definitions (ChatMessage, ToolCall…) | `src/renderer/llm/types.ts` |
| Cancellation token | `src/renderer/llm/cancellation.ts` |
| Gemma tool definitions (4 tools) | `src/renderer/tools.ts` |
| System prompt | `src/renderer/prompts.ts` |
| Agentic chat loop + tool dispatch | `src/renderer/hooks/useChat.ts` |
| Ollama health check + model detection + STT | `src/renderer/services/OllamaService.ts` |
| CodeMirror 6 editor wrapper | `src/renderer/components/EditorPanel.tsx` |
| Chat UI + message list | `src/renderer/components/ChatPanel.tsx` |
| Text input row | `src/renderer/components/InputRow.tsx` |
| Message bubble + Markdown render | `src/renderer/components/Message.tsx` |
| Voice mic button + E4B pipeline | `src/renderer/components/VoiceInput.tsx` |
| Saved project sidebar | `src/renderer/components/ProjectList.tsx` |
| Error boundary (kid-friendly fallback) | `src/renderer/components/ErrorBoundary.tsx` |
| Global styles | `src/renderer/styles.css` |
| esbuild build config | `esbuild.config.mjs` |
| Electron Builder packaging | `electron-builder.yml` |

Grep before adding any new constant, type, or function. If logic overlaps an existing owner, extend the owner instead of creating a parallel file.

---

## Architecture Rules
- All IPC calls go through `preload.ts` → `window.electronAPI` — never use `ipcRenderer` directly in components
- Renderer network is restricted to `localhost:11434` by CSP — do not add other origins
- AI-generated HTML is opened via `shell.openExternal('file://...')` in the user's default browser — never rendered inside Electron
- `keep_alive: 0` on every `gemma4:e4b` call — forces immediate VRAM unload so `gemma4:26b` loads cleanly
- Tool calls use strict JSON Schema (`tools.ts`) — never a free-form string blob argument
- Conversation truncation before each `streamChatCompletion` call: system prompt + last 10 user/assistant pairs + last 4 tool results
- Filename collision in `save-animation` IPC: if content differs, append `-2`, `-3`, etc. — never silently overwrite
- `save_animation` always receives the full HTML file — never a partial snippet
- Every `EditorView.dispatch()` must be guarded: `if (viewRef.current) { viewRef.current.dispatch(...) }`
- `useEffect` that creates an `EditorView` must call `view.destroy()` in its cleanup

---

## Build Commands
```bash
npm run dev          # build + open Electron window
npm run build        # esbuild: main + preload + renderer
npm run typecheck    # tsc --noEmit strict check
npm run dist:win     # Windows NSIS installer
npm run dist:mac     # macOS DMG
npm run dist:linux   # Linux AppImage
```

Run `npm run build` and `npm run typecheck` before finishing any change. Both must be clean.

---

## TypeScript Rules
- `"strict": true` always — no `any` without an inline justification comment
- No `any` in IPC payloads — define explicit types in `global.d.ts` or `types.ts`
- Use `AbortController` / `CancellationToken` for all cancellable streaming operations
- Prefer composition over inheritance
- Do not import Node modules (`fs`, `path`, `electron`) into renderer files — IPC only

---

## No Fallbacks Unless Requested
- No silent error swallowing
- No hardcoded fallback model names in production paths — detect from Ollama `/api/tags`
- Surface Ollama errors to the user with a kid-friendly message — never bury them
- Show a clear setup screen when Ollama is not running — do not silently fail

---

## Ask vs Proceed

| Situation | Action |
|---|---|
| Adding a new npm dependency | **Ask** |
| Creating a file not listed in `build_plan.md` | **Ask** |
| Relaxing CSP in `index.html` | **Ask** |
| Changing `contextIsolation` or `nodeIntegration` settings | **Ask** |
| Adding an outbound network endpoint that isn't `localhost:11434` | **Ask** |
| Modifying files in `src/renderer/llm/` | **Ask** |
| Implementing work that belongs to a future plan day | **Ask** |
| Bug fix within current scope | Proceed |
| Formatting / lint-style fixes | Proceed |
| Adding missing types or type guards | Proceed |
| Extracting a constant or helper within the same file's concern | Proceed |
| Internal refactor with no API/behavior change | Proceed |
