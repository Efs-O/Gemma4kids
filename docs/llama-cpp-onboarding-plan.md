# Gemma4kids Plan: First-Run Wizard + Dual Environment (Ollama / llama.cpp)

## Scope & Intent
This plan defines a reviewable implementation path for:

1. A first-run welcome screen with a “don’t show again” option.
2. Environment selection in onboarding: **Ollama Server** (default) or **llama.cpp** (advanced).
3. Full llama.cpp advanced workflow with manual model placement, configurable flags, and integration into the same UI/pipeline currently used for Ollama.

The current model naming is accepted as-is.

---

## Goals
- Keep beginner setup simple and safe (Ollama-first).
- Expose llama.cpp as an advanced path without blocking core users.
- Ensure both environments can drive the existing app pipeline and UI features.
- Preserve feature parity where feasible (model selector, generation flow, save/open/delete, optional voice flows).

## Non-Goals (Phase 1)
- Auto-installing llama.cpp binaries.
- Auto-downloading GGUF models.
- Hidden/silent system-level installers on macOS.

---

## User Experience Plan

## 1) First Launch Entry
- Show a **Welcome / Setup Assistant** modal/page at startup for first-time users.
- Include checkbox/toggle: **“Don’t show this again”**.
- Persist user preference in app settings.

### Behavior
- If first run and not dismissed: show wizard.
- If dismissed: go directly into app.
- Add “Open Setup Assistant” in Help/settings so users can re-open anytime.

## 2) Environment Selection Step
- Step in wizard: **Choose Runtime Environment**
  - **Ollama Server (Recommended)**
  - **llama.cpp (Advanced)** with explanatory text:
    - “For advanced users: full model parameter control, quant/version selection, custom flags.”

### Ollama card
- Keep current behavior as default/easy path.
- Guided checks: installed, server running, models available.

### llama.cpp card
- Clearly mark as advanced/manual setup.
- Explain that user installs llama.cpp server manually and places GGUF files into local model folders.

---

## llama.cpp Advanced Workflow (Target Design)

## 3) Local Model Folder Convention
Create 4 folders (if missing) under an app-controlled directory (prefer userData path):

- `e2b/`
- `e4b/`
- `e26b/`
- `e31b/`

Users manually download model files from Hugging Face and drop them into the desired folder.

### Notes
- Support multiple files per family (3-bit / 4-bit / large / medium / small variants).
- Scanner should identify valid GGUF files and expose them as selectable model variants.

## 4) llama.cpp Config File
Introduce a user-editable config (JSON/JSONC/TOML; pick one and document):

- Global llama.cpp server settings.
- Per-model-family defaults.
- Per-model-file overrides.
- Full flag passthrough support (context, batch, threads, gpu layers, rope/kv/cache params, etc.).

### Example Config Sections
- `server`: host, port, startup command hints, timeout.
- `models.e2b/e4b/e26b/e31b`: default flags and preferred default file.
- `profiles`: named presets (balanced / quality / speed).

## 5) Manual Installation Guidance for llama.cpp
In wizard and docs:
- Link to official llama.cpp GitHub releases/install instructions.
- Explain manual install is intentional due rapid upstream changes.
- Provide verification steps (e.g., start server, ping endpoint).

---

## Architecture Plan

## 6) Runtime Abstraction Layer
Refactor current model backend usage behind a common interface:

- `LLMRuntimeAdapter` (shared contract)
  - `healthCheck()`
  - `listModels()`
  - `chat()` / `streamChat()`
  - optional `transcribe()` support marker
  - `supportsThinking`, `supportsTools`, `supportsMultimodal` capability flags

### Implementations
- `OllamaAdapter` (existing behavior)
- `LlamaCppAdapter` (new)

This keeps UI logic mostly unchanged while switching providers via adapter.

## 7) Model Registry & Selector Integration
Unify selector data model to include:
- runtime (`ollama` or `llama_cpp`)
- family (`e2b/e4b/e26b/e31b`)
- variant label (quant/size)
- concrete identifier (Ollama tag or local GGUF path key)

Selector must surface both runtime-specific models and preserve current UX.

## 8) Pipeline Compatibility
Ensure selected llama.cpp model can run through the same core pipeline used today:
- prompt composition
- streaming response handling
- save/open/delete project flows
- renderer update hooks
- any tool-calling flow currently supported (with fallback behavior if runtime lacks parity)

---

## First-Run Checks & Setup Actions

## 9) Wizard Checks (Ollama)
- Server reachable.
- Required model(s) present.
- Optional Piper and voice assets status.

## 10) Wizard Checks (llama.cpp)
- Server reachable at configured host/port.
- Model folders exist.
- At least one valid GGUF discovered.
- Config file parse/validation status.

### Action Buttons
- “Open instructions”
- “Open model folder”
- “Open config file”
- “Re-scan”

---


## Packaging & macOS Distribution Requirements

## 13) DMG Packaging Rules (macOS)
- Continue distributing test builds as `.dmg` for Mac users.
- Keep the base app install lightweight: **do not bundle voice language packs** in the DMG.
- Piper binary may be bundled if size/license policy allows, but the app must still support fallback discovery in `userData`.
- Keep first-launch instructions explicit for unsigned testing flows (right-click → Open) until signing/notarization is enabled.

## 14) Piper + Voice Asset Policy
- Bundle strategy:
  - Piper binary: optional in package (preferred for easier first-run TTS enablement).
  - Voice files: not packaged by default.
- First-run setup action:
  - Download **English-only** voice pack (`en_US-amy-medium`) to `userData/voices`.
  - Validate both `.onnx` and `.onnx.json` exist before marking TTS ready.
- Keep TTS optional: app remains fully usable for chat/coding even when Piper/voices are missing.

## 15) First-Run Auto-Download Behavior (Voices)
- Wizard must include a “Download English Voice” action with progress + retry.
- If offline or download fails:
  - show clear non-blocking warning;
  - allow user to continue into app;
  - keep a “Retry setup” action in Help/settings.
- Cache-aware behavior:
  - skip re-download when matching voice assets already exist.

## 16) Ollama Requirement Automation Boundaries (macOS)
- Do not attempt silent auto-install of Ollama from within the app.
- Implement guided automation only:
  - detect Ollama installation/running state;
  - deep-link to official download/instructions;
  - re-scan readiness after user action.
- Wizard should clearly state Ollama is required for default runtime operation.

## Migration / Persistence

## 11) Settings Keys
Add persisted settings:
- `onboarding.dismissed`
- `runtime.selected`
- `runtime.ollama.*`
- `runtime.llama_cpp.*`

## 12) Backward Compatibility
- Existing users default to current Ollama flow.
- If no llama.cpp setup exists, no disruption.
- Optional feature gating so unfinished llama.cpp capabilities can be hidden safely.

---

## Security, Reliability, and Guardrails
- Keep all runtime endpoints local by default.
- Validate file paths; prevent directory traversal for model path ingestion.
- Validate config schema; show actionable errors.
- Timeouts/retries for health checks.
- Clear fallback messaging when features differ between runtimes.

---

## Phased Implementation Plan

## Phase 0 — Planning & Contracts
- Finalize runtime adapter interface.
- Finalize folder naming and config schema.
- Define capability matrix (Ollama vs llama.cpp).

## Phase 1 — Onboarding Shell
- Add welcome screen + “don’t show again”.
- Add runtime selection step.
- Add open/reopen setup entry point.

## Phase 2 — llama.cpp Discovery Layer
- Add model folder creation + scanner.
- Add config file read/validate.
- Add readiness checks and wizard diagnostics.

## Phase 3 — Backend Adapter Integration
- Implement `LlamaCppAdapter` with list/check/chat support.
- Wire selector to runtime-aware model registry.
- Route chat pipeline via selected adapter.

## Phase 4 — UX Hardening
- Better errors and guided resolution.
- Config editor/link helpers.
- Docs/screenshots/update setup copy.

## Phase 5 — Parity & Polish
- Evaluate advanced flags UI (optional).
- Improve presets for common Mac hardware tiers.
- Add telemetry-free local diagnostics report export.

---

## Acceptance Criteria (Review Gate)
1. First-run wizard appears and can be permanently dismissed.
2. User can reopen wizard from app settings/help.
3. Runtime can be set to Ollama or llama.cpp.
4. llama.cpp path supports manual model drops in the four family folders.
5. Model selector displays discovered llama.cpp variants.
6. Selecting llama.cpp model runs end-to-end generation through existing UI flow.
7. Clear setup instructions exist for manual llama.cpp install and model management.
8. Ollama default path remains stable and unchanged for non-advanced users.

---

## Open Decisions for Review
- Config format choice (JSON vs JSONC vs TOML).
- Exact llama.cpp API mode expected (OpenAI-compatible vs native server endpoints).
- Which features are mandatory parity in v1 vs deferred.
- Whether STT/voice-related flows remain Ollama-only initially.

---

## Suggested Next Step
Approve this plan, then implement **Phase 1 + Phase 2** first so onboarding and advanced setup visibility are delivered early, before full llama.cpp inference routing.
