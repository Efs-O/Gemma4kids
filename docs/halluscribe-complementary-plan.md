# Complimentary Plan: Reusing Halluscribe Patterns for Gemma4kids llama.cpp Integration

## Purpose
This document complements `docs/llama-cpp-onboarding-plan.md` with a focused reuse strategy from **Halluscribe**. It defines what to port, what to adapt, and what to avoid so Gemma4kids can add llama.cpp with lower risk and less reinvention.

---

## Objectives
- Reuse proven dual-backend patterns (Ollama + llama.cpp).
- Keep Gemma4kids UX simple for families while enabling advanced runtime controls.
- Minimize regression risk by porting small, testable slices.
- Preserve existing Gemma4kids behaviors (model selection, save/open flows, chat pipeline).

---

## Halluscribe Areas to Reuse (Concept Level)

## 1) Backend Selection and Settings Model
Reuse the idea of a persisted backend enum and runtime-specific settings buckets:
- backend: `ollama` | `llamacpp`
- runtime-specific fields (host/port/model for Ollama, server path/port/model for llama.cpp)

### Gemma4kids adaptation
- Keep Ollama as default.
- Add llama.cpp fields in settings without exposing all advanced flags on day 1.
- Gate advanced controls behind “Advanced” section.

## 2) Runtime Readiness Checks
Reuse the readiness/check loop concept for both providers:
- provider reachable?
- configured model available?
- retry + actionable errors

### Gemma4kids adaptation
- Integrate readiness checks into first-run wizard.
- Keep checks non-blocking where possible (except critical Ollama path for default runtime).

## 3) llama-server Spawn + Health Workflow
Reuse the flow pattern:
- spawn `llama-server`
- wait for readiness endpoint with timeout
- handle early process exit
- surface clear diagnostics

### Gemma4kids adaptation
- Encapsulate process management in main process only.
- Add safe timeouts and “Open setup help” fallback actions.

## 4) Tool-Calling / Payload Shape Compatibility
Reuse the explicit handling for backend message/tool payload differences.

### Gemma4kids adaptation
- Centralize schema translation in adapter layer.
- Prevent UI-level branching by normalizing responses to one internal shape.

## 5) Provider-Specific Testing Harnesses
Reuse the idea of small backend smoke checks and loop checks.

### Gemma4kids adaptation
- Add lightweight checks for:
  - list models
  - single prompt response
  - stream response
  - tool call roundtrip (if enabled)

---

## What NOT to Port Directly
- Halluscribe app-specific session/archive/retrieval semantics.
- Any settings fields not relevant to Gemma4kids kid-facing flows.
- Overly broad advanced controls in first release.

---

## Target Gemma4kids Work Breakdown

## Phase A — Integration Skeleton
1. Introduce `runtime.selected` setting (`ollama` default).
2. Add adapter interface (`healthCheck`, `listModels`, `chat/stream`, capability flags).
3. Wire current Ollama logic through `OllamaAdapter`.

## Phase B — llama.cpp Baseline
1. Add `LlamaCppAdapter` (HTTP client to running llama-server).
2. Add optional server spawn helper in main process.
3. Implement health check timeout + diagnostics mapping.

## Phase C — Model Discovery & Selection
1. Add folder scanner for `e2b/e4b/e26b/e31b` GGUF variants.
2. Map discovered variants to selector entries.
3. Preserve selected model across sessions per runtime.

## Phase D — Wizard Integration
1. Add environment step + advanced llama.cpp card.
2. Add guided checks/actions for Ollama and llama.cpp.
3. Add “don’t show again” persistence and reopen entry point.

## Phase E — Hardening
1. Normalize error taxonomy across providers.
2. Add backend-specific telemetry-free diagnostics export.
3. Add regression checks for existing Gemma4kids features.

---

## Mapping Matrix (Source Pattern → Gemma4kids Destination)
- Backend selector/settings pattern → Gemma4kids settings store + onboarding wizard
- Readiness probes → setup assistant checks panel
- llama-server lifecycle pattern → main-process runtime service
- payload normalization pattern → `LLMRuntimeAdapter` implementations
- smoke/check scripts pattern → local dev checks for each backend

---

## Risk Register & Mitigations

## Risk 1: Backend payload mismatches
- Mitigation: adapter-level normalization + snapshot tests for translated payloads.

## Risk 2: llama-server startup instability on user machines
- Mitigation: timeout/retry with explicit remediation text and manual mode fallback.

## Risk 3: UX complexity for non-technical parents
- Mitigation: Ollama-first defaults, hide advanced llama.cpp controls behind gated UI.

## Risk 4: Model naming/variant drift
- Mitigation: canonical family IDs (`e2b/e4b/e26b/e31b`) + robust scanner metadata.

---

## Definition of Done (Complimentary Plan)
1. Halluscribe reuse points are translated into concrete Gemma4kids modules/tasks.
2. Each reused pattern has an owner location in Gemma4kids architecture.
3. llama.cpp baseline path can run a basic prompt through the same UI shell.
4. Default Ollama path remains unchanged for standard users.

---

## Immediate Next Actions
1. Create a short technical design doc for Gemma4kids adapters (method signatures + data contracts).
2. Implement Phase A in a small PR (no llama.cpp yet, only abstraction + Ollama wrap).
3. Implement Phase B in a follow-up PR (llama.cpp baseline + health checks).
4. Validate with side-by-side manual checks against Halluscribe behavior.
