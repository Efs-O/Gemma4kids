# Gemma 4 Speculative Decoding Plan (MTP + Assistant Models)

## Why this report exists

Some user machines are reporting poor latency with `gemma4:e2b` and `gemma4:e4b`, even when the app is functionally correct. This report captures a practical rollout plan for testing Gemma 4 Multi-Token Prediction (MTP) assistants **outside `master/main`** so production stability is not impacted during experiments.

---

## Problem statement

Current problem:
- App works reliably, but interactive speed is inconsistent across machines.
- On lower-memory or partially-offloaded systems, single-turn latency can feel too high for child-focused UX.

Goal:
- Improve real-time responsiveness without regressing output quality or stability.
- Keep the existing production path unchanged until performance evidence is strong.

Non-goal:
- This plan does **not** change core architecture in the first phase.
- This plan does **not** assume all hardware tiers will benefit equally.

---

## Technical background (summarized)

Gemma 4 MTP uses a small assistant (drafter) model to propose multiple tokens, then the larger target model verifies them in parallel. If a draft token is rejected, the target still produces the correct token for that position, preserving correctness.

Important model-family behavior:
- **Dense targets (e.g., 31B)**: verification overhead is usually lower, often enabling stronger gains in single-request flows.
- **MoE targets (e.g., 26B-A4B)**: verification may trigger different experts per drafted token; at batch size 1, this can reduce or erase gains on some systems.

Implication for this app:
- For one-user chat sessions, 31B + assistant may provide the most obvious speedup.
- 26B-A4B + assistant still merits testing, but expectations should be conservative for batch=1 hardware.

---

## Compatibility rules (critical)

1. Use **matched target + matched assistant** checkpoints only.
2. Do not mix runtime formats in one process path:
   - HF/Transformers pipelines require HF-format checkpoints.
   - llama.cpp-style pipelines require GGUF checkpoints.
3. Treat MTP as feature-flagged until it is validated on representative machines.

---

## Branching and safety strategy

Recommended branch naming:
- `exp/mtp-assistant-bench`
- `exp/mtp-31b`
- `exp/mtp-26b-a4b`

Safety controls:
- Keep default production behavior unchanged.
- Add config toggle(s) for assistant mode.
- Add telemetry/logging only to local benchmark output (no remote analytics).
- Merge only after pre-defined acceptance thresholds are met.

---

## Experiment matrix

Run all tests with identical prompts and deterministic generation settings where possible.

Dimensions to sweep:
- Target model: `e2b`, `e4b`, `26b-a4b`, `31b`
- Assistant mode: off vs on
- Draft depth: 2, 3, 4
- Context window sizes: 8k / 16k
- Offload profile: high-GPU, partial-offload, RAM-heavy
- Concurrency: single request (primary), small parallel load (secondary)

Primary metrics:
- End-to-end latency (time to final token)
- Time-to-first-token
- Sustained tokens/sec
- Draft acceptance rate
- VRAM usage and host RAM usage
- User-visible smoothness (subjective chat responsiveness)

---

## Suggested execution sequence

### Phase 1 — Baseline
- Capture no-assistant baseline across hardware tiers.
- Identify machines where e2b/e4b are currently unacceptable.

### Phase 2 — 31B assistant path
- Enable MTP assistant with conservative draft depth (`2` or `3`).
- Keep assistant as GPU-resident when possible.
- Compare against baseline on single-request chat.

### Phase 3 — 26B-A4B assistant path
- Run same procedure for MoE target.
- Evaluate whether gains appear only under light concurrency.

### Phase 4 — decision gate
- Promote only configurations that beat baseline with stable quality.
- Keep slower/neutral configurations disabled by default.

---

## Rollout criteria

Promote experimental mode only if all are true on target hardware tier:
1. Median latency improves by an agreed threshold (example: >=20%).
2. No noticeable quality regressions in kid-facing coding tasks.
3. No increased crash or OOM rate during 30+ minute sessions.
4. Startup and model-switch behavior remain acceptable.

If any criterion fails:
- Keep feature flag off for that tier.
- Document fallback profile (non-assistant path).

---

## Practical note on your specific question

Is it worth trying? **Yes**—with controlled expectations:
- For dense 31B paths: likely yes, usually most promising.
- For MoE 26B-A4B at batch size 1: maybe; measure first, because gains can be limited on offloaded systems.
- For format mixing: do not combine HF and GGUF in one runtime path.

---

## Deliverables checklist

- [ ] Branch with assistant feature flag and no default behavior changes
- [ ] Reproducible benchmark script/config for all model tiers
- [ ] Benchmark result table committed in markdown
- [ ] Go/no-go recommendation per hardware profile
- [ ] Rollback note and default-safe settings
